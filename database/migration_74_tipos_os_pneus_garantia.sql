-- =============================================================================
-- Migration 74 - Tipos de OS Pneus e Garantia de Fabrica (09/11/2026)
--
-- Pedido do Tiago: a Indisponibilidade de Frota (retencoes_frota) passa a
-- aceitar PNEUS e GARANTIA FABRICA alem de CORRETIVA, PREVENTIVA e SINISTRO.
-- So amplia a lista do CHECK; nenhum registro muda.
-- =============================================================================

ALTER TABLE retencoes_frota DROP CONSTRAINT IF EXISTS retencoes_frota_tipo_os_check;
ALTER TABLE retencoes_frota ADD  CONSTRAINT retencoes_frota_tipo_os_check
  CHECK (tipo_os IS NULL OR tipo_os IN ('', 'SINISTRO', 'CORRETIVA', 'PREVENTIVA', 'PNEUS', 'GARANTIA FABRICA'));
