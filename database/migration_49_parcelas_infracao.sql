-- =============================================================================
-- MIGRATION 49 — Parcelamento de infração (24/09/2026)
-- =============================================================================
-- Sai com a v6.8.2. Duas colunas em infracoes:
--
--   parcelas               em quantas vezes a multa é descontada (1 a 12)
--   data_primeira_parcela  a data da 1ª; as seguintes caem no mesmo dia dos
--                          meses seguintes (dia inexistente → último dia do
--                          mês). As datas e valores de cada parcela são
--                          CALCULADOS pelo app, não gravados.
--
-- O STATUS continua sendo da multa inteira: depois da assinatura o
-- financeiro agenda o desconto mensal, e parcela a parcela não interessa
-- aqui (decisão do Tiago, 24/09/2026).
--
-- parcelas É NULLABLE DE PROPÓSITO. As multas lançadas na 6.8.0/6.8.1 não
-- têm a chave no objeto local; a projeção do cloudStore manda null para
-- número ausente. Com NOT NULL, o primeiro envio dessas multas depois da
-- 6.8.2 seria recusado — e o PostgREST recusa o LOTE INTEIRO. O app lê
-- null como 1 parcela. O CHECK aceita null (regra do Postgres).
--
-- ORDEM: rodar ANTES de publicar a 6.8.2 — a lista branca nova manda as duas
-- colunas, e coluna que não existe derruba o lote (PGRST204).
--
-- Idempotente: pode rodar duas vezes.
-- =============================================================================

ALTER TABLE infracoes ADD COLUMN IF NOT EXISTS parcelas INT DEFAULT 1;
ALTER TABLE infracoes ADD COLUMN IF NOT EXISTS data_primeira_parcela DATE;

ALTER TABLE infracoes DROP CONSTRAINT IF EXISTS ck_infracoes_parcelas;
ALTER TABLE infracoes ADD CONSTRAINT ck_infracoes_parcelas CHECK (parcelas BETWEEN 1 AND 12);
