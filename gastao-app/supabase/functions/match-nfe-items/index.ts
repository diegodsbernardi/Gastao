import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface NFeItem {
  descricao: string;
  unidade: string;
  [key: string]: unknown;
}

interface Ingredient {
  id: string;
  name: string;
  unit_type: string;
  tipo: string;
}

interface AIMatch {
  item_index: number;
  insumo_id: string | null;
  confianca: number;
  motivo?: string;
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
    return jsonError("Token de autenticação necessário", 401);
  }

  try {
    const body = await req.json();
    const { itens, restaurant_id } = body as {
      itens: NFeItem[];
      restaurant_id: string;
    };

    if (!Array.isArray(itens) || itens.length === 0) {
      return jsonError('Campo "itens" deve ser um array não-vazio', 400);
    }
    if (!restaurant_id) {
      return jsonError('Campo "restaurant_id" é obrigatório', 400);
    }

    // ------------------------------------------------------------------
    // 1. Busca insumos do restaurante
    // ------------------------------------------------------------------
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: authHeader } } }
    );

    const { data: ingredients, error: ingError } = await supabase
      .from("ingredients")
      .select("id, name, unit_type, tipo")
      .eq("restaurant_id", restaurant_id);

    if (ingError) {
      throw new Error("Erro ao buscar insumos: " + ingError.message);
    }

    // Sem insumos cadastrados → retorna sem matches
    if (!ingredients || ingredients.length === 0) {
      return jsonOK({
        matches: itens.map((_, i) => ({
          item_index: i,
          insumo_id: null,
          confianca: 0,
          motivo: "Nenhum insumo cadastrado no restaurante",
        })),
      });
    }

    // ------------------------------------------------------------------
    // 2. Chama Claude em batch (1 chamada para todos os itens)
    // ------------------------------------------------------------------
    const matches = await matchWithAI(itens, ingredients as Ingredient[]);

    return jsonOK({ matches });
  } catch (err) {
    return jsonError(String(err), 500);
  }
});

// ---------------------------------------------------------------------------
// Helpers
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

// ---------------------------------------------------------------------------
// AI matching
// ---------------------------------------------------------------------------

async function matchWithAI(
  itens: NFeItem[],
  ingredients: Ingredient[]
): Promise<AIMatch[]> {
  const itemsList = itens
    .map((it, i) => `${i + 1}. "${it.descricao}" (unidade: ${it.unidade})`)
    .join("\n");

  const catalogList = ingredients
    .map(
      (ing, i) =>
        `${i + 1}. [id: "${ing.id}"] ${ing.name} (unidade: ${ing.unit_type}, tipo: ${ing.tipo})`
    )
    .join("\n");

  // Conteúdo ESTÁVEL (instruções) — cacheado entre todas as notas.
  const systemPrompt = `Você é um especialista em gestão de restaurantes e insumos alimentares.
Sua tarefa é associar itens de notas fiscais (NF-e) com insumos já cadastrados no sistema.

Considere:
- Variações de nome e abreviações (ex: "FILÉ DE FRANGO CG" → "Frango")
- Equivalências de unidade (ex: "PCT" pode ser "KG" dependendo do contexto)
- Nomes comerciais vs. nomes genéricos
- Siglas comuns em NF-e: CX=caixa, PCT=pacote, UN=unidade, LT=lata/litro, SC=saco, FD=fardo

Retorne APENAS JSON válido, sem texto adicional.`;

  // Catálogo do restaurante — estável dentro de um upload em lote, então
  // também vai no system com cache_control: cada nota seguinte do mesmo
  // restaurante reaproveita o cache (5 min) e custa ~quase nada.
  const catalogBlock = `CATÁLOGO DE INSUMOS DO RESTAURANTE:
${catalogList}`;

  // Conteúdo VARIÁVEL (itens desta nota) — fica no user message.
  const userPrompt = `Associe cada item da nota fiscal com o insumo mais adequado do catálogo.

ITENS DA NOTA FISCAL:
${itemsList}

Retorne JSON no formato exato:
{
  "matches": [
    {"item_index": 0, "insumo_id": "uuid-aqui-ou-null", "confianca": 0.95, "motivo": "breve justificativa"},
    ...
  ]
}

Regras:
- item_index começa em 0 e vai até ${itens.length - 1}
- confianca é um número de 0.0 a 1.0
- Use insumo_id: null quando a confiança for menor que 0.5 ou não houver match razoável
- Retorne exatamente ${itens.length} entradas no array`;

  const anthropicRes = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "x-api-key": Deno.env.get("ANTHROPIC_API_KEY")!,
      "anthropic-version": "2023-06-01",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 8192,
      temperature: 0,
      system: [
        { type: "text", text: systemPrompt },
        // breakpoint de cache no fim do catálogo → cacheia instruções + catálogo
        { type: "text", text: catalogBlock, cache_control: { type: "ephemeral" } },
      ],
      messages: [
        { role: "user", content: userPrompt },
        // prefill força a resposta a começar como JSON (sem cercas markdown)
        { role: "assistant", content: "{" },
      ],
    }),
  });

  if (!anthropicRes.ok) {
    const errText = await anthropicRes.text();
    throw new Error(`Erro na API Anthropic (${anthropicRes.status}): ${errText}`);
  }

  const anthropicData = await anthropicRes.json();
  // prefill "{" não volta na resposta — reconstituímos o JSON completo
  const rawText: string = anthropicData.content?.[0]?.text ?? "";
  const content = "{" + rawText;

  let parsed: { matches: AIMatch[] };
  try {
    parsed = JSON.parse(content);
  } catch {
    throw new Error("Resposta da IA não é JSON válido: " + content.slice(0, 300));
  }

  if (!Array.isArray(parsed.matches)) {
    throw new Error("Formato inesperado da resposta da IA");
  }

  // Garante que o número de matches coincide com o número de itens
  const normalised: AIMatch[] = itens.map((_, i) => {
    const match = parsed.matches.find((m) => m.item_index === i);
    return match ?? { item_index: i, insumo_id: null, confianca: 0 };
  });

  return normalised;
}
