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
  type: string;
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
      .select("id, name, unit_type, type")
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
    // 2. Chama GPT-4o mini em batch (1 chamada para todos os itens)
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
        `${i + 1}. [id: "${ing.id}"] ${ing.name} (unidade: ${ing.unit_type}, tipo: ${ing.type})`
    )
    .join("\n");

  const systemPrompt = `Você é um especialista em gestão de restaurantes e insumos alimentares.
Sua tarefa é associar itens de notas fiscais (NF-e) com insumos já cadastrados no sistema.

Considere:
- Variações de nome e abreviações (ex: "FILÉ DE FRANGO CG" → "Frango")
- Equivalências de unidade (ex: "PCT" pode ser "KG" dependendo do contexto)
- Nomes comerciais vs. nomes genéricos
- Siglas comuns em NF-e: CX=caixa, PCT=pacote, UN=unidade, LT=lata/litro, SC=saco, FD=fardo

Retorne APENAS JSON válido, sem texto adicional.`;

  const userPrompt = `Associe cada item da nota fiscal com o insumo mais adequado do catálogo.

ITENS DA NOTA FISCAL:
${itemsList}

CATÁLOGO DE INSUMOS DO RESTAURANTE:
${catalogList}

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

  const openaiRes = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${Deno.env.get("OPENAI_API_KEY")}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: "gpt-4o-mini",
      temperature: 0,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt },
      ],
    }),
  });

  if (!openaiRes.ok) {
    const errText = await openaiRes.text();
    throw new Error(`Erro na API OpenAI (${openaiRes.status}): ${errText}`);
  }

  const openaiData = await openaiRes.json();
  const content: string = openaiData.choices?.[0]?.message?.content ?? "";

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
