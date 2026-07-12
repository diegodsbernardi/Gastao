import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { XMLParser } from "https://esm.sh/fast-xml-parser@4.3.4";

// Origins autorizadas a chamar esta function. Qualquer outra origin recebe
// a primeira da lista (fallback) no header CORS.
const ALLOWED_ORIGINS = [
  "https://gastao-app.vercel.app",
  "http://localhost:5173",
];

function corsHeadersFor(req: Request): Record<string, string> {
  const origin = req.headers.get("Origin") ?? "";
  const allowed = ALLOWED_ORIGINS.includes(origin)
    ? origin
    : ALLOWED_ORIGINS[0];
  return {
    "Access-Control-Allow-Origin": allowed,
    "Access-Control-Allow-Headers":
      "authorization, x-client-info, apikey, content-type",
  };
}

// Limite anti-DoS: XML acima disso é rejeitado com 413 antes de parsear.
const MAX_BODY_BYTES = 3 * 1024 * 1024; // 3 MB

serve(async (req) => {
  const corsHeaders = corsHeadersFor(req);

  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  // Exige ao menos a presença do header Authorization (verify_jwt já valida a
  // presença/assinatura no gateway; este check é uma guarda explícita).
  if (!req.headers.get("Authorization")) {
    return jsonError(corsHeaders, "Token de autenticação necessário", 401);
  }

  // Rejeita cedo por Content-Length quando disponível (evita ler o body todo).
  const declaredLen = Number(req.headers.get("content-length") ?? "");
  if (Number.isFinite(declaredLen) && declaredLen > MAX_BODY_BYTES) {
    return jsonError(corsHeaders, "XML muito grande (máx. 3 MB)", 413);
  }

  try {
    let xmlText: string;

    const contentType = req.headers.get("content-type") ?? "";

    if (contentType.includes("multipart/form-data")) {
      const formData = await req.formData();
      const file = formData.get("file");
      if (!file || typeof file === "string") {
        return jsonError(corsHeaders, 'Campo "file" ausente ou inválido no multipart', 400);
      }
      if ((file as File).size > MAX_BODY_BYTES) {
        return jsonError(corsHeaders, "XML muito grande (máx. 3 MB)", 413);
      }
      xmlText = await (file as File).text();
    } else {
      // application/xml, text/xml ou raw body
      xmlText = await req.text();
    }

    // Guarda pós-leitura: cobre o caso sem Content-Length confiável.
    if (new TextEncoder().encode(xmlText).length > MAX_BODY_BYTES) {
      return jsonError(corsHeaders, "XML muito grande (máx. 3 MB)", 413);
    }

    if (!xmlText.trim()) {
      return jsonError(corsHeaders, "Body vazio — envie o XML da NF-e", 400);
    }

    const result = parseNFe(xmlText);
    return new Response(JSON.stringify(result), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    return jsonError(corsHeaders, String(err), 400);
  }
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function jsonError(
  corsHeaders: Record<string, string>,
  message: string,
  status: number,
) {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

/** Lê uma string de um possível path de tags aninhadas no objeto NFe. */
// deno-lint-ignore no-explicit-any
function getStr(obj: any, ...keys: string[]): string {
  let cur = obj;
  for (const k of keys) {
    if (cur == null) return "";
    cur = cur[k];
  }
  if (cur == null) return "";
  return String(cur).trim();
}

function formatCNPJ(raw: string): string {
  const d = raw.replace(/\D/g, "");
  if (d.length !== 14) return raw;
  return `${d.slice(0, 2)}.${d.slice(2, 5)}.${d.slice(5, 8)}/${d.slice(8, 12)}-${d.slice(12)}`;
}

// ---------------------------------------------------------------------------
// Parser principal
// ---------------------------------------------------------------------------

interface NFeItem {
  codigo_produto: string;
  descricao: string;
  quantidade: number;
  unidade: string;
  valor_unitario: number;
  valor_total: number;
  // Unidade tributável (uTrib/qTrib/vUnTrib): geralmente a unidade física real
  // (ex: KG) por trás da unidade comercial (ex: CX). É o que permite converter
  // "2 CX" → "20,03 KG" e calcular o preço por unidade de ficha.
  quantidade_tributavel: number;
  unidade_tributavel: string;
  valor_unitario_tributavel: number;
}

interface NFeNota {
  numero: string;
  data_emissao: string;
  fornecedor_nome: string;
  fornecedor_cnpj: string;
  valor_total: number;
}

function parseNFe(xmlText: string): { nota: NFeNota; itens: NFeItem[] } {
  // Remove declarações de namespace e prefixos pra acessar tags sem namespace
  const clean = xmlText
    .replace(/\s+xmlns(?::[a-zA-Z0-9_-]+)?="[^"]*"/g, "")
    .replace(/<([/]?)([a-zA-Z0-9_-]+):([a-zA-Z0-9_-]+)/g, "<$1$3");

  const parser = new XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: "@_",
    parseTagValue: false,    // mantém valores como string — parseamos sob demanda
    parseAttributeValue: false,
    trimValues: true,
  });

  // deno-lint-ignore no-explicit-any
  let doc: any;
  try {
    doc = parser.parse(clean);
  } catch (e) {
    throw new Error("XML malformado: " + String(e).slice(0, 200));
  }

  // Aceita nfeProc (envelope com proto) ou NFe avulsa
  const nfeRoot = doc.nfeProc?.NFe ?? doc.NFe;
  if (!nfeRoot) {
    throw new Error("XML inválido: não é uma NF-e (nfeProc ou NFe não encontrado)");
  }

  const infNFe = nfeRoot.infNFe;
  if (!infNFe) {
    throw new Error("XML inválido: elemento infNFe não encontrado");
  }

  // ------ Cabeçalho ------
  const ide = infNFe.ide ?? {};
  const emit = infNFe.emit ?? {};
  const total = infNFe.total ?? {};
  const ICMSTot = total.ICMSTot ?? infNFe.ICMSTot ?? {};

  const numero = getStr(ide, "nNF");
  const dataEmissao = getStr(ide, "dhEmi") || getStr(ide, "dEmi");
  const fornecedorNome = getStr(emit, "xNome") || getStr(emit, "xFant");
  const fornecedorCNPJ = getStr(emit, "CNPJ");
  const valorTotalStr = getStr(ICMSTot, "vNF");

  // ------ Itens ------
  // <det> pode vir como array (vários itens) ou objeto (1 item só) no fast-xml-parser
  const detRaw = infNFe.det;
  // deno-lint-ignore no-explicit-any
  const detArr: any[] = Array.isArray(detRaw) ? detRaw : detRaw ? [detRaw] : [];

  if (detArr.length === 0) {
    throw new Error("NF-e sem itens (nenhum elemento <det> encontrado)");
  }

  const itens: NFeItem[] = [];

  for (const det of detArr) {
    const prod = det.prod;
    if (!prod) continue;

    const descricao = getStr(prod, "xProd");
    if (!descricao) continue;

    itens.push({
      codigo_produto: getStr(prod, "cProd"),
      descricao,
      quantidade: parseFloat(getStr(prod, "qCom")) || 0,
      unidade: getStr(prod, "uCom"),
      valor_unitario: parseFloat(getStr(prod, "vUnCom")) || 0,
      valor_total: parseFloat(getStr(prod, "vProd")) || 0,
      // Fallback pra unidade comercial quando o XML não traz a tributável
      quantidade_tributavel:
        parseFloat(getStr(prod, "qTrib")) || parseFloat(getStr(prod, "qCom")) || 0,
      unidade_tributavel: getStr(prod, "uTrib") || getStr(prod, "uCom"),
      valor_unitario_tributavel:
        parseFloat(getStr(prod, "vUnTrib")) || parseFloat(getStr(prod, "vUnCom")) || 0,
    });
  }

  if (itens.length === 0) {
    throw new Error("Nenhum item com descrição encontrado na NF-e");
  }

  const totalCalculado = itens.reduce((s, it) => s + it.valor_total, 0);

  return {
    nota: {
      numero,
      data_emissao: dataEmissao,
      fornecedor_nome: fornecedorNome,
      fornecedor_cnpj: formatCNPJ(fornecedorCNPJ),
      valor_total: parseFloat(valorTotalStr) || totalCalculado,
    },
    itens,
  };
}
