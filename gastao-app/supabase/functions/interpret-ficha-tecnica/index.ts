import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface SheetData {
  name: string;
  headers: string[];
  sample_rows: unknown[][];
  all_rows: unknown[][];
}

interface RequestBody {
  restaurant_id: string;
  sheets: SheetData[];
  existing_ingredient_names: string[];
  existing_recipe_names: string[];
}

// -- Claude response (Phase 1: schema detection) --

interface ColumnMap {
  name_col: number;
  unit_col: number | null;
  cost_col: number | null;
  aproveitamento_col: number | null;
  price_col: number | null;
  yield_col: number | null;
  yield_unit_col: number | null;
  tipo: string;
  category: string | null;
  // composition-specific
  recipe_name_col: number | null;
  ingredient_name_col: number | null;
  quantity_col: number | null;
  comp_unit_col: number | null;
  // mixed format
  structure: "flat" | "grouped_rows" | null;
}

interface SheetMapping {
  sheet_name: string;
  interpretation: "ingredients" | "recipes" | "compositions" | "mixed" | "ignore";
  confidence: number;
  column_map: ColumnMap;
  notes: string;
}

interface ClaudeResponse {
  sheet_mappings: SheetMapping[];
  overall_confidence: number;
  warnings: string[];
}

// -- Output types (Phase 2: deterministic extraction) --

interface ParsedIngredient {
  _source_sheet: string;
  _source_row: number;
  name: string;
  tipo: string;
  unit_type: string;
  avg_cost_per_unit: number;
  aproveitamento: number;
  is_duplicate: boolean;
  duplicate_of?: string;
}

interface ParsedRecipe {
  _source_sheet: string;
  _source_row: number;
  product_name: string;
  tipo: string;
  sale_price: number;
  category: string;
  yield_quantity: number;
  unit_type: string;
  is_duplicate: boolean;
  duplicate_of?: string;
}

interface ParsedComposition {
  recipe_name: string;
  component_name: string;
  component_type: "ingredient" | "sub_recipe";
  quantity_needed: number;
  unit: string;
}

interface InterpretationResult {
  ingredients: ParsedIngredient[];
  recipes: ParsedRecipe[];
  compositions: ParsedComposition[];
  warnings: string[];
  ai_confidence: number;
}

// ---------------------------------------------------------------------------
// Main handler
// ---------------------------------------------------------------------------

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  const authHeader = req.headers.get("Authorization");
  if (!authHeader) {
    return jsonError("Token de autenticacao necessario", 401);
  }

  try {
    const body: RequestBody = await req.json();
    const { sheets, existing_ingredient_names, existing_recipe_names } = body;

    if (!Array.isArray(sheets) || sheets.length === 0) {
      return jsonError('Campo "sheets" deve ser um array nao-vazio', 400);
    }

    // ------------------------------------------------------------------
    // Phase 1: Claude interprets headers + sample rows
    // ------------------------------------------------------------------
    const claudeMapping = await interpretWithClaude(
      sheets,
      existing_ingredient_names ?? [],
      existing_recipe_names ?? [],
    );

    // ------------------------------------------------------------------
    // Phase 2: Deterministic extraction using mapping
    // ------------------------------------------------------------------
    const result = extractData(
      sheets,
      claudeMapping,
      existing_ingredient_names ?? [],
      existing_recipe_names ?? [],
    );

    return jsonOK(result);
  } catch (err) {
    return jsonError(String(err), 500);
  }
});

// ---------------------------------------------------------------------------
// Phase 1: Claude API call
// ---------------------------------------------------------------------------

async function interpretWithClaude(
  sheets: SheetData[],
  existingIngNames: string[],
  existingRecNames: string[],
): Promise<ClaudeResponse> {
  const apiKey = Deno.env.get("ANTHROPIC_API_KEY");
  if (!apiKey) throw new Error("ANTHROPIC_API_KEY nao configurada");

  const systemPrompt = `Voce e um especialista em fichas tecnicas de restaurantes brasileiros.
Sua tarefa e analisar a estrutura de uma planilha Excel e retornar um mapeamento de colunas em JSON.

O modelo do sistema tem 3 camadas:
1. INSUMOS (ingredients): materias-primas compradas de fornecedores
   - tipos validos: insumo_base, insumo_direto, embalagem
   - Se a aba lista ingredientes com custo/preco de compra, sao insumos
   - insumo_base = usado em preparos (carne, queijo, farinha)
   - insumo_direto = vai direto no produto final (pao, embalagem descartavel)
   - embalagem = material de embalagem

2. RECEITAS tipo preparo: sub-receitas intermediarias com rendimento
   - Se tem coluna de rendimento/yield, e preparo
   - Ex: "Molho Especial rende 2L", "Hamburguer Smash 80g rende 10un"

3. RECEITAS tipo ficha_final: produtos vendidos ao cliente com preco de venda
   - Se lista produtos com preco de venda, sao fichas finais
   - categorias: Lanche, Porcao, Sobremesa, Combo, Bebida, Outro

4. COMPOSICAO: vincula receitas aos seus componentes (ingredientes + quantidades)
   - Pode aparecer como: aba separada, linhas agrupadas sob cada produto, ou colunas laterais

REGRAS:
- Colunas podem ter nomes em PT-BR com abreviacoes: qtd/qty=quantidade, vl/vlr=valor, desc=descricao, un/und=unidade
- Custo (PRIORIDADE para cost_col): "Preço Compra", "Preço de Compra", "Custo Unitário", "Vlr Unitario" (usar preco de compra pois sera atualizado por notas fiscais)
- Se existem AMBOS "Preço Compra" e "Custo Líquido", use "Preço Compra" como cost_col
- Venda: venda, pvp, preco final, valor de venda, preco de venda
- Unidades: kg, g, l, ml, un, cx, pct, fatia, folha, colher, xicara
- Se uma aba mistura produtos e seus ingredientes (linhas agrupadas), use interpretation="mixed" com structure="grouped_rows"
- Se a aba nao contem dados uteis, use interpretation="ignore"

Retorne APENAS JSON valido, sem markdown, sem texto adicional.`;

  const sheetsDescription = sheets
    .map((s) => {
      const sampleTable = s.sample_rows
        .slice(0, 5)
        .map((row, i) => `  Linha ${i + 1}: ${JSON.stringify(row)}`)
        .join("\n");
      return `--- Aba: "${s.name}" (${s.all_rows.length} linhas) ---\nColunas: ${JSON.stringify(s.headers)}\nAmostras:\n${sampleTable}`;
    })
    .join("\n\n");

  const existingInfo =
    existingIngNames.length > 0 || existingRecNames.length > 0
      ? `\nINSUMOS JA CADASTRADOS: ${existingIngNames.slice(0, 150).join(", ") || "nenhum"}\nRECEITAS JA CADASTRADAS: ${existingRecNames.slice(0, 150).join(", ") || "nenhuma"}`
      : "";

  const userPrompt = `Analise esta planilha e retorne o mapeamento de colunas.

${sheetsDescription}
${existingInfo}

Retorne JSON no formato:
{
  "sheet_mappings": [
    {
      "sheet_name": "nome da aba",
      "interpretation": "ingredients" | "recipes" | "compositions" | "mixed" | "ignore",
      "confidence": 0.95,
      "column_map": {
        "name_col": 0,
        "unit_col": 1,
        "cost_col": 2,
        "aproveitamento_col": null,
        "price_col": null,
        "yield_col": null,
        "yield_unit_col": null,
        "tipo": "insumo_base",
        "category": null,
        "recipe_name_col": null,
        "ingredient_name_col": null,
        "quantity_col": null,
        "comp_unit_col": null,
        "structure": null
      },
      "notes": "breve explicacao"
    }
  ],
  "overall_confidence": 0.85,
  "warnings": []
}

Regras para column_map:
- Para ingredients: preencha name_col, unit_col, cost_col, aproveitamento_col (coluna "Aprovtm.", "Aproveitamento %", pode ser 0-1 ou 0-100), tipo
- Para recipes: preencha name_col, price_col, tipo (preparo|ficha_final), category, yield_col se preparo
- Para compositions: preencha recipe_name_col, ingredient_name_col, quantity_col, comp_unit_col
- Para mixed: preencha os campos relevantes + structure ("grouped_rows" ou "flat")
- Indices de coluna comecam em 0
- Campos nao aplicaveis devem ser null`;

  // Retry up to 3 times on 429/529 (overloaded/rate-limited)
  let res: Response | null = null;
  for (let attempt = 0; attempt < 3; attempt++) {
    res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: "claude-sonnet-4-6",
        max_tokens: 8192,
        temperature: 0,
        messages: [
          { role: "user", content: userPrompt },
        ],
        system: systemPrompt,
      }),
    });

    if (res.ok || (res.status !== 429 && res.status !== 529)) break;

    // Wait before retry: 2s, 4s, 8s
    const waitMs = 2000 * Math.pow(2, attempt);
    await new Promise((r) => setTimeout(r, waitMs));
  }

  if (!res!.ok) {
    const errText = await res!.text();
    throw new Error(`Erro na API Claude (${res!.status}): ${errText}`);
  }

  const data = await res.json();
  const content = data.content?.[0]?.text ?? "";

  // Strip markdown fences if present
  const cleaned = content.replace(/```json\s*/g, "").replace(/```\s*/g, "").trim();

  let parsed: ClaudeResponse;
  try {
    parsed = JSON.parse(cleaned);
  } catch {
    throw new Error("Resposta da IA nao e JSON valido: " + cleaned.slice(0, 500));
  }

  if (!Array.isArray(parsed.sheet_mappings)) {
    throw new Error("Formato inesperado da resposta da IA");
  }

  return parsed;
}

// ---------------------------------------------------------------------------
// Phase 2: Deterministic extraction
// ---------------------------------------------------------------------------

function extractData(
  sheets: SheetData[],
  mapping: ClaudeResponse,
  existingIngNames: string[],
  existingRecNames: string[],
): InterpretationResult {
  const ingNamesLower = new Set(existingIngNames.map((n) => n.toLowerCase().trim()));
  const recNamesLower = new Set(existingRecNames.map((n) => n.toLowerCase().trim()));

  const ingredients: ParsedIngredient[] = [];
  const recipes: ParsedRecipe[] = [];
  const compositions: ParsedComposition[] = [];
  const warnings: string[] = [...(mapping.warnings ?? [])];

  for (const sm of mapping.sheet_mappings) {
    const sheet = sheets.find((s) => s.name === sm.sheet_name);
    if (!sheet || sm.interpretation === "ignore") continue;

    const cm = sm.column_map;

    try {
      if (sm.interpretation === "ingredients") {
        for (let i = 0; i < sheet.all_rows.length; i++) {
          const row = sheet.all_rows[i];
          const name = cellStr(row, cm.name_col);
          if (!name) continue;

          const dupName = findDuplicate(name, ingNamesLower);
          const rawAprov = cm.aproveitamento_col != null ? parseBRNumber(cellRaw(row, cm.aproveitamento_col)) : 1;
          // Aproveitamento can be 0-1 or 0-100, normalize to 0-1
          const aproveitamento = rawAprov > 1 ? rawAprov / 100 : (rawAprov > 0 ? rawAprov : 1);
          ingredients.push({
            _source_sheet: sm.sheet_name,
            _source_row: i + 2,
            name,
            tipo: cm.tipo || "insumo_base",
            unit_type: normalizeUnit(cellStr(row, cm.unit_col) || "un"),
            avg_cost_per_unit: parseBRNumber(cellRaw(row, cm.cost_col)),
            aproveitamento,
            is_duplicate: !!dupName,
            ...(dupName ? { duplicate_of: dupName } : {}),
          });
        }
      } else if (sm.interpretation === "recipes") {
        for (let i = 0; i < sheet.all_rows.length; i++) {
          const row = sheet.all_rows[i];
          const name = cellStr(row, cm.name_col);
          if (!name) continue;

          const dupName = findDuplicate(name, recNamesLower);
          recipes.push({
            _source_sheet: sm.sheet_name,
            _source_row: i + 2,
            product_name: name,
            tipo: cm.tipo || "ficha_final",
            sale_price: parseBRNumber(cellRaw(row, cm.price_col)),
            category: cm.category || "Outro",
            yield_quantity: cm.yield_col != null ? parseBRNumber(cellRaw(row, cm.yield_col)) || 1 : 1,
            unit_type: cm.yield_unit_col != null
              ? normalizeUnit(cellStr(row, cm.yield_unit_col) || "un")
              : "un",
            is_duplicate: !!dupName,
            ...(dupName ? { duplicate_of: dupName } : {}),
          });
        }
      } else if (sm.interpretation === "compositions") {
        for (let i = 0; i < sheet.all_rows.length; i++) {
          const row = sheet.all_rows[i];
          const recipeName = cellStr(row, cm.recipe_name_col);
          const componentName = cellStr(row, cm.ingredient_name_col);
          if (!recipeName || !componentName) continue;

          compositions.push({
            recipe_name: recipeName,
            component_name: componentName,
            component_type: "ingredient",
            quantity_needed: parseBRNumber(cellRaw(row, cm.quantity_col)) || 1,
            unit: normalizeUnit(cellStr(row, cm.comp_unit_col) || "un"),
          });
        }
      } else if (sm.interpretation === "mixed" && cm.structure === "grouped_rows") {
        // Mixed: rows alternate between recipe header and ingredient lines
        let currentRecipe: string | null = null;

        for (let i = 0; i < sheet.all_rows.length; i++) {
          const row = sheet.all_rows[i];
          const nameVal = cellStr(row, cm.name_col);
          if (!nameVal) continue;

          const hasPrice = cm.price_col != null && cellRaw(row, cm.price_col);
          const hasQuantity = cm.quantity_col != null && parseBRNumber(cellRaw(row, cm.quantity_col)) > 0;

          if (hasPrice && !hasQuantity) {
            // This is a recipe header row
            currentRecipe = nameVal;
            const dupName = findDuplicate(nameVal, recNamesLower);
            recipes.push({
              _source_sheet: sm.sheet_name,
              _source_row: i + 2,
              product_name: nameVal,
              tipo: cm.tipo || "ficha_final",
              sale_price: parseBRNumber(cellRaw(row, cm.price_col)),
              category: cm.category || "Outro",
              yield_quantity: 1,
              unit_type: "un",
              is_duplicate: !!dupName,
              ...(dupName ? { duplicate_of: dupName } : {}),
            });
          } else if (currentRecipe && hasQuantity) {
            // This is a composition line under the current recipe
            const componentName = cm.ingredient_name_col != null
              ? cellStr(row, cm.ingredient_name_col) || nameVal
              : nameVal;

            compositions.push({
              recipe_name: currentRecipe,
              component_name: componentName,
              component_type: "ingredient",
              quantity_needed: parseBRNumber(cellRaw(row, cm.quantity_col)),
              unit: normalizeUnit(cellStr(row, cm.comp_unit_col) || "un"),
            });
          }
        }
      }
    } catch (err) {
      warnings.push(`Erro ao processar aba "${sm.sheet_name}": ${String(err)}`);
    }
  }

  // Cross-reference compositions: mark sub_recipe type for components that match recipe names
  const recipeNames = new Set(recipes.map((r) => r.product_name.toLowerCase().trim()));
  for (const comp of compositions) {
    if (recipeNames.has(comp.component_name.toLowerCase().trim())) {
      comp.component_type = "sub_recipe";
    }
  }

  return {
    ingredients,
    recipes,
    compositions,
    warnings,
    ai_confidence: mapping.overall_confidence ?? 0,
  };
}

// ---------------------------------------------------------------------------
// Utility functions
// ---------------------------------------------------------------------------

function jsonOK(data: unknown) {
  return new Response(JSON.stringify(data), {
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function jsonError(message: string, status: number) {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function cellRaw(row: unknown[], colIndex: number | null | undefined): unknown {
  if (colIndex == null || !Array.isArray(row)) return null;
  return row[colIndex] ?? null;
}

function cellStr(row: unknown[], colIndex: number | null | undefined): string {
  const val = cellRaw(row, colIndex);
  if (val == null) return "";
  return String(val).trim();
}

function parseBRNumber(v: unknown): number {
  if (v == null) return 0;
  // If already a number (from Excel), return directly — don't mangle the decimal point
  if (typeof v === "number") return isNaN(v) ? 0 : v;
  const s = String(v).replace(/[R$\s]/g, "");
  // Only apply BR formatting if string contains comma (e.g., "1.234,56")
  if (s.includes(",")) {
    const cleaned = s.replace(/\./g, "").replace(",", ".");
    const n = parseFloat(cleaned);
    return isNaN(n) ? 0 : n;
  }
  const n = parseFloat(s);
  return isNaN(n) ? 0 : n;
}

const UNIT_MAP: Record<string, string> = {
  quilograma: "kg", quilogramas: "kg", quilo: "kg", quilos: "kg", kilo: "kg", kilos: "kg",
  grama: "g", gramas: "g",
  litro: "l", litros: "l",
  mililitro: "ml", mililitros: "ml",
  unidade: "un", unidades: "un", und: "un", peca: "un", pecas: "un", pc: "un", pcs: "un",
  caixa: "cx", caixas: "cx",
  pacote: "pct", pacotes: "pct",
  fatia: "fatia", fatias: "fatia",
  folha: "folha", folhas: "folha",
};

function normalizeUnit(raw: string): string {
  const lower = raw.toLowerCase().trim();
  return UNIT_MAP[lower] ?? lower;
}

function findDuplicate(name: string, existingSet: Set<string>): string | null {
  const lower = name.toLowerCase().trim();
  if (existingSet.has(lower)) return name;
  return null;
}
