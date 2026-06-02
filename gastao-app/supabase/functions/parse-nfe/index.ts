import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { XMLParser } from "https://esm.sh/fast-xml-parser@4.3.4";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    let xmlText: string;

    const contentType = req.headers.get("content-type") ?? "";

    if (contentType.includes("multipart/form-data")) {
      const formData = await req.formData();
      const file = formData.get("file");
      if (!file || typeof file === "string") {
        return jsonError('Campo "file" ausente ou inválido no multipart', 400);
      }
      xmlText = await (file as File).text();
    } else {
      // application/xml, text/xml ou raw body
      xmlText = await req.text();
    }

    if (!xmlText.trim()) {
      return jsonError("Body vazio — envie o XML da NF-e", 400);
    }

    const result = parseNFe(xmlText);
    return new Response(JSON.stringify(result), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    return jsonError(String(err), 400);
  }
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function jsonError(message: string, status: number) {
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
