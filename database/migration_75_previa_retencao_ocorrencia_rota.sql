-- =============================================================================
-- Migration 75 - Previa de retencao a partir da ocorrencia em rota (09/11/2026)
--
-- Decisoes do Tiago (09/11):
--   * Toda ocorrencia em rota NOVA gera sozinha uma previa na Indisponibilidade
--     da Frota, com status A_VALIDAR. As ja abertas ficam como estao.
--   * A oficina valida (vira RETIDO, com tipo de OS, link e previsao) ou
--     descarta (DESCARTADO: o veiculo nao ficou indisponivel).
--   * A_VALIDAR nao conta como indisponivel em lugar nenhum (KPIs, relatorio,
--     escala, view do Power BI): so depois de validado.
--   * O vinculo com a ocorrencia fica so no banco (ocorrencia_rota_id), sem
--     campo na tela. Cada uma fecha por conta propria: CCO a ocorrencia,
--     oficina a retencao.
-- =============================================================================

ALTER TABLE retencoes_frota ADD COLUMN IF NOT EXISTS ocorrencia_rota_id bigint;

CREATE INDEX IF NOT EXISTS idx_ret_frota_ocorrencia_rota
  ON retencoes_frota (ocorrencia_rota_id) WHERE ocorrencia_rota_id IS NOT NULL;

ALTER TABLE retencoes_frota DROP CONSTRAINT IF EXISTS retencoes_frota_status_check;
ALTER TABLE retencoes_frota ADD  CONSTRAINT retencoes_frota_status_check
  CHECK (status IS NULL OR status IN ('', 'RETIDO', 'LIBERADO', 'A_VALIDAR', 'DESCARTADO'));

-- A previa nasce sem tipo de OS (e, se o veiculo nao estiver no cadastro, sem
-- tipo de veiculo). A sincronia envia texto vazio como null, entao as duas
-- colunas deixam de ser NOT NULL; o CHECK de tipo_os ja aceitava NULL.
ALTER TABLE retencoes_frota ALTER COLUMN tipo_os DROP NOT NULL;
ALTER TABLE retencoes_frota ALTER COLUMN tipo_veiculo DROP NOT NULL;
