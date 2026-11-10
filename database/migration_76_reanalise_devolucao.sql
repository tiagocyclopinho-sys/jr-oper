-- =============================================================================
-- Migration 76 - Devolucao corrigida volta para a Analise (10/11/2026)
--
-- Pedido dos operadores (10/11): a Analise ja tinha passado pela ocorrencia
-- (causa raiz preenchida = aba "Monitorados"), o SAC achou uma falha na
-- tratativa e corrigiu. A ocorrencia continuava em Monitorados, porque a aba
-- e decidida so pela causa raiz preenchida.
--
-- Agora a correcao do SAC (updateDevolucaoSac) marca reanalise_pendente e a
-- ocorrencia volta para "Pendentes" na Analise, com a apuracao anterior
-- preenchida no formulario. Salvar a analise de novo (updateInvestigacao)
-- desmarca. reanalise_motivo/reanalise_desde guardam o porque e o quando da
-- ultima correcao (ficam como historico depois de desmarcar).
-- =============================================================================

ALTER TABLE ocorrencias_devolucao ADD COLUMN IF NOT EXISTS reanalise_pendente boolean DEFAULT false;
ALTER TABLE ocorrencias_devolucao ADD COLUMN IF NOT EXISTS reanalise_motivo   text;
ALTER TABLE ocorrencias_devolucao ADD COLUMN IF NOT EXISTS reanalise_desde    timestamp without time zone;

NOTIFY pgrst, 'reload schema';
