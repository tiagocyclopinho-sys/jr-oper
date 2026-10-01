-- =====================================================================
-- MIGRATION 50 — BAIXA DA DESTINAÇÃO DE ITENS (6.8.5, 01/10/2026)
-- =====================================================================
-- Pedido dos supervisores: item que já foi descartado, vendido, consumido
-- ou reintegrado ao estoque continuava na "Destinação de Itens". A
-- destinação diz PARA ONDE o item vai dentro do CD; a baixa registra que
-- a ação foi FEITA (quando, por quem, qual). Item com baixa sai da fila e
-- passa para a lista "Baixas Realizadas".
--
-- Tudo VARCHAR/TEXT, de propósito (mesmo motivo da migration 26 com
-- data_validade): itens_devolucao não tem lista branca no cloudStore, o
-- objeto sobe como está. Uma coluna DATE recusaria "" com HTTP 400 e
-- derrubaria o lote inteiro; uma TIMESTAMPTZ voltaria do banco em outro
-- formato e o hash nunca bateria (reenvio eterno a cada ciclo).
--
-- divisoes_destino em itens_devolucao: o botão "Dividir" já gravava esse
-- campo no item de devolução, mas a coluna só existia no avulso. Todo
-- aparelho que dividiu um item de devolução estava com o envio de
-- itens_devolucao recusado (PGRST204). Esta migration fecha isso também.
-- A baixa de cada parte de um item dividido mora dentro do próprio JSON.
--
-- Rodar ANTES do deploy da 6.8.5.
-- =====================================================================

ALTER TABLE itens_devolucao
  ADD COLUMN IF NOT EXISTS divisoes_destino JSONB,
  ADD COLUMN IF NOT EXISTS baixa_acao  VARCHAR(40),
  ADD COLUMN IF NOT EXISTS baixa_data  VARCHAR(10),
  ADD COLUMN IF NOT EXISTS baixa_em    VARCHAR(30),
  ADD COLUMN IF NOT EXISTS baixa_por   VARCHAR(150),
  ADD COLUMN IF NOT EXISTS baixa_obs   TEXT;

ALTER TABLE itens_avulsos_destinacao
  ADD COLUMN IF NOT EXISTS baixa_acao  VARCHAR(40),
  ADD COLUMN IF NOT EXISTS baixa_data  VARCHAR(10),
  ADD COLUMN IF NOT EXISTS baixa_em    VARCHAR(30),
  ADD COLUMN IF NOT EXISTS baixa_por   VARCHAR(150),
  ADD COLUMN IF NOT EXISTS baixa_obs   TEXT;

NOTIFY pgrst, 'reload schema';
