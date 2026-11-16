-- =============================================================================
-- MIGRATION 78 — Previsão de largada na escala (16/11/2026)
-- =============================================================================
-- Sai com a v7.4.0. Pedido do Tiago depois de um veículo da largada de 15/11
-- não ter saído e isso só aparecer no dia seguinte: a portaria recebe uma via
-- impressa do fechamento com a hora prevista de saída de cada viagem, para
-- cobrar ou avisar quando alguém não sair.
--
-- Matriz: largada_dias (0 = no dia da escala, -1 = na véspera: a rota longa
-- sai à tarde do dia anterior e pertence à matriz do dia seguinte) e
-- largada_hora ('HH:MM'). Sem hora = não informada.
--
-- Escala: previsao_largada (data e hora). A linha que veio da matriz usa a
-- da matriz; a viagem avulsa (incluída à mão ou nova pelo Fusion) precisa
-- informar a sua.
--
-- A previsão NÃO vai para as imagens dos grupos (prestador não tem horário a
-- cumprir); sai só na Via da portaria.
--
-- Idempotente. Só acrescenta colunas: a versão no ar ignora.
-- =============================================================================

ALTER TABLE escala_matrizes ADD COLUMN IF NOT EXISTS largada_dias SMALLINT NOT NULL DEFAULT 0;
ALTER TABLE escala_matrizes ADD COLUMN IF NOT EXISTS largada_hora VARCHAR(5);
ALTER TABLE escala_linhas   ADD COLUMN IF NOT EXISTS previsao_largada TIMESTAMP;

ALTER TABLE escala_matrizes DROP CONSTRAINT IF EXISTS ck_escala_matrizes_largada_dias;
ALTER TABLE escala_matrizes ADD CONSTRAINT ck_escala_matrizes_largada_dias CHECK (largada_dias IN (-1, 0));
