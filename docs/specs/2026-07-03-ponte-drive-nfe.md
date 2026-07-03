# Ponte Google Drive → NF-e (no lugar do provider SEFAZ, por ora)

> Decisão (02/07): adiar a automação SEFAZ (provider pago, ver
> `2026-07-02-decisao-provider-nfe.md`). Como a Cinco já salva os XMLs no Drive,
> a fonte passa a ser o Drive — custo R$ 0. Quando quisermos SEFAZ, só troca a fonte.

## Como funciona

Robô (`gastao-app/scripts/nfe-drive-sync.mjs`) roda no VPS via cron **2×/dia
(08h e 17h BRT)**. Para cada restaurante ativo em `nfe_drive_sync`:

1. Lista os XMLs da pasta `NotasEntrada` no Drive (service account, leitura).
2. **Dedup por chave de acesso** (44 dígitos; unique no banco, migration 027) —
   já pula pelo nome do arquivo, sem nem baixar.
3. Valida o destinatário: CNPJ do XML tem que bater com `restaurantes.cnpj`
   (nota na pasta errada é ignorada com aviso no log).
4. Parseia via edge function `parse-nfe` (aceita anon key) e sugere insumos com
   match local por similaridade de palavras (lê `ingredients` direto do Postgres).
5. Grava `notas_fiscais` (status **pendente**, `origem = 'drive'`,
   `xml_url = drive:<fileId>`) + `nfe_itens` numa transação.

**Confirmação continua 100% humana** — estoque/custo só mudam quando alguém
confirma a nota na UI, como sempre.

O upload manual da UI continua funcionando e agora também grava `chave_acesso`
(origem `upload`) — robô e upload não se duplicam.

## Estado (03/07)

- ✅ Migration 027 aplicada em prod (chave única + tabela `nfe_drive_sync`).
- ✅ Pastas mapeadas e ativas: Brut, Criminal, Yalinha (CNPJs preenchidos a partir
  dos próprios XMLs). TOCS ainda não tem pasta no Drive.
- ✅ Pipeline testado ponta a ponta contra prod (insert + dedup + limpeza).
- ✅ Cron instalado; log em `~/logs/gastao-nfe-drive-sync.log`.
- ⏳ **Falta só a service account do Google** (checklist abaixo). Sem ela o robô
  sai em silêncio, sem erro.

## Setup pendente (Diego, ~10 min, tudo no navegador)

1. Acessar https://console.cloud.google.com logado como diegodsbernardi@gmail.com.
2. Criar projeto: barra do topo → seletor de projeto → **New Project** → nome
   `gastao-nfe` → Create.
3. Ativar a API do Drive: menu ☰ → **APIs & Services → Library** → buscar
   "Google Drive API" → **Enable**.
4. Criar a service account: menu ☰ → **IAM & Admin → Service Accounts** →
   **Create service account** → nome `gastao-nfe-robo` → Create and continue →
   (não precisa dar papel nenhum) → Done.
5. Criar a chave: clicar na service account criada → aba **Keys** →
   **Add key → Create new key → JSON → Create**. Baixa um arquivo `.json`.
6. Copiar o e-mail da service account (formato
   `gastao-nfe-robo@gastao-nfe.iam.gserviceaccount.com`).
7. No Drive, na pasta-mãe dos restaurantes (a que contém Brut & Rose, Criminal,
   Yalinha…), clicar com o direito → **Compartilhar** → colar o e-mail da service
   account → papel **Leitor** → Enviar (desmarcar "notificar"). Se não tiver
   permissão de compartilhar, pedir pra Cinco fazer isso.
8. Colocar o JSON no servidor: abrir o arquivo baixado no Bloco de Notas e
   copiar TUDO. No terminal do servidor:
   `nano ~/.gastao-google-sa.json` → colar → `Ctrl+O` `Enter` `Ctrl+X`.
9. Testar sem gravar nada:
   `node /home/diego/projects/Gastao/gastao-app/scripts/nfe-drive-sync.mjs --dry-run`
   Deve listar as notas que importaria. Rodar de novo sem `--dry-run` pra
   importar de verdade (ou esperar o cron das 08h/17h).

## Operação

- Log: `tail -50 ~/logs/gastao-nfe-drive-sync.log`
- Status por restaurante: tabela `nfe_drive_sync` (`last_sync_at`, `last_result`).
- Ligar/desligar um restaurante: `UPDATE nfe_drive_sync SET ativo = false WHERE …`.
- Novo restaurante: criar pasta `NotasEntrada` no Drive, inserir linha em
  `nfe_drive_sync` (id da pasta) e preencher `restaurantes.cnpj`.

## Limitações conhecidas

- Sugestão de insumo do robô é match **local por palavras** (conservador), não a
  IA do `match-nfe-items` — a function lê `ingredients` com o JWT do chamador e
  o robô não tem usuário. Pra usar a IA: alterar a function pra aceitar
  service-role e redeployar (precisa de `supabase login`, não tem token no VPS).
- O XML não é copiado pro Storage; a fonte é o Drive (`xml_url = drive:<fileId>`).
  Se apagarem o arquivo do Drive, perde-se o XML original (a nota importada fica).
