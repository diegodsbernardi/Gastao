import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

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

/**
 * Remove declarações de namespace e prefixos de elementos para que
 * getElementsByTagName() funcione sem necessidade de NS explícito.
 * Mantém atributos normais intactos.
 */
function stripNamespaces(xml: string): string {
  return xml
    .replace(/\s+xmlns(?::[a-zA-Z0-9_-]+)?="[^"]*"/g, "")
    .replace(/<([/]?)([a-zA-Z0-9_-]+):([a-zA-Z0-9_-]+)/g, "<$1$3");
}

function getText(el: Element | null, tag: string): string {
  if (!el) return "";
  const child = el.getElementsByTagName(tag)[0];
  return child?.textContent?.trim() ?? "";
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
  const clean = stripNamespaces(xmlText);

  const parser = new DOMParser();
  const doc = parser.parseFromString(clean, "text/xml");

  // Falha de parse
  const parseErr = doc.getElementsByTagName("parsererror")[0];
  if (parseErr) {
    throw new Error("XML malformado: " + parseErr.textContent?.slice(0, 200));
  }

  // Valida que é NF-e (aceita nfeProc ou NFe avulsa)
  const hasNfeProc = doc.getElementsByTagName("nfeProc").length > 0;
  const hasNFe = doc.getElementsByTagName("NFe").length > 0;
  if (!hasNfeProc && !hasNFe) {
    throw new Error(
      "XML inválido: não é uma NF-e (nfeProc ou NFe não encontrado)"
    );
  }

  const infNFe = doc.getElementsByTagName("infNFe")[0];
  if (!infNFe) {
    throw new Error("XML inválido: elemento infNFe não encontrado");
  }

  // ------ Cabeçalho ------
  const ide = infNFe.getElementsByTagName("ide")[0] ?? null;
  const emit = infNFe.getElementsByTagName("emit")[0] ?? null;
  const ICMSTot =
    infNFe.getElementsByTagName("ICMSTot")[0] ??
    infNFe.getElementsByTagName("total")[0]
      ?.getElementsByTagName("ICMSTot")[0] ??
    null;

  const numero = getText(ide, "nNF");
  const dataEmissao = getText(ide, "dhEmi") || getText(ide, "dEmi"); // dEmi = formato legado
  const fornecedorNome =
    getText(emit, "xNome") || getText(emit, "xFant") || "";
  const fornecedorCNPJ = getText(emit, "CNPJ");
  const valorTotalStr = getText(ICMSTot, "vNF");

  // ------ Itens ------
  const detElements = infNFe.getElementsByTagName("det");
  if (detElements.length === 0) {
    throw new Error("NF-e sem itens (nenhum elemento <det> encontrado)");
  }

  const itens: NFeItem[] = [];

  for (let i = 0; i < detElements.length; i++) {
    const det = detElements[i];
    const prod = det.getElementsByTagName("prod")[0];
    if (!prod) continue;

    const descricao = getText(prod, "xProd");
    if (!descricao) continue;

    const quantidade = parseFloat(getText(prod, "qCom") || "0");
    const valorUnitario = parseFloat(getText(prod, "vUnCom") || "0");
    const valorTotal = parseFloat(getText(prod, "vProd") || "0");

    itens.push({
      codigo_produto: getText(prod, "cProd"),
      descricao,
      quantidade,
      unidade: getText(prod, "uCom"),
      valor_unitario: valorUnitario,
      valor_total: valorTotal,
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
