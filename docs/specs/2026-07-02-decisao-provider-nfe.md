# Decisão de provider — NF-e automática (Fase 0)

> Parte do plano "NF-e automática multi-cliente". Objetivo: puxar NF-e **recebidas**
> (notas emitidas contra o CNPJ do restaurante) automaticamente da SEFAZ, sem upload manual.

## Requisito técnico que vale pra TODOS os providers

Puxar NF-e recebidas usa o serviço **Distribuição DF-e** da SEFAZ, que exige um
**certificado digital A1 (e-CNPJ)** de cada restaurante. Não tem como fugir disso —
é a SEFAZ que exige. **Ponto-chave pro modelo BPO:** a Cinco, como contadora dos
clientes, muito provavelmente **já tem os certificados A1** dos restaurantes (contador
costuma guardar). Se tiver, o multi-cliente destrava agora. Se não tiver, cada
restaurante precisa emitir/autorizar um A1 — é a maior fricção do projeto, não o código.

## Comparação

| Provider | Recebidas? | Preço | Certificado | Perfil |
|----------|-----------|-------|-------------|--------|
| **FocusNFe** | Sim (recebimento em todos os planos) | **Solo R$89,90** (1 CNPJ) / **Start R$113,90** (3 CNPJ) / **Growth R$548** (CNPJ ilimitado, 4000 notas) | Só A1 | Preço transparente, sem setup/fidelidade. Fit direto pro BPO multi-CNPJ (Growth). |
| **Nuvem Fiscal** | Sim (Distribuição DF-e, REST) | ~R$360/mês (anual), por cota de operações | A1 | Mais "dev-first" (REST puro, scope `distribuicao-nfe`). Cada pedido/manifestação conta cota. |
| **Arquivei / Qive** | Sim (API 2.0, filtro OwnerRoles recebido/emitido, manifestação gerenciada) | Sob consulta (enterprise, provável mais caro) | Gerencia pra você | Turnkey, menos ops, mais caro e menos transparente. |

## Recomendação

**FocusNFe (plano Growth, R$548/mês, CNPJ ilimitado)** para o build multi-cliente:
- Preço transparente e o plano ilimitado casa com o modelo BPO (N restaurantes num contrato).
- Suporta recebimento de NF-e em todos os planos.
- A1 é o que a Cinco já deve ter.
- Sem setup nem fidelidade → dá pra testar com o TOCS no plano Solo (R$89,90) antes de escalar.

Runner-up: **Nuvem Fiscal** se preferirmos um modelo REST/Distribuição-DFe mais puro.
Arquivei/Qive só se "zero operação de certificado" valer mais que o custo.

## Abstração no código

Independente da escolha, o código fala com uma interface `NfeProvider.listNewInvoices(cnpj, since)
→ [{ chave_acesso, xml }]`. Trocar de provider = trocar 1 adapter. Começar com o adapter
do provider escolhido.

## Decisões pendentes do Diego (gate da Fase 1)

1. **Confirmar com a Cinco: eles têm os certificados A1 (e-CNPJ) dos restaurantes?** (gate de viabilidade).
2. Aprovar o provider (recomendação: FocusNFe) e o custo recorrente.
3. Contratar plano Solo (só TOCS) pra validar, ou já Growth (multi-CNPJ).
