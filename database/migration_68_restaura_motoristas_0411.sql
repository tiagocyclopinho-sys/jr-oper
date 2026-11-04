-- =============================================================================
-- MIGRATION 68 — Restaura motoristas excluídos em 04/11/2026
-- =============================================================================
-- Pedido do Tiago: motorista com infração não pode sair do cadastro. Volta como
-- estava antes da exclusão das 11:37. TESTE CLAUDE IGNORAR (id 1787258390204),
-- sem nenhum vínculo, continua excluído.
--   2 DEUSIVALDO LEONCO FERREIRA, 3 CARLOS ALEXANDRE SANTOS DE SOUZA,
--   7 EDSON ARRUDA, 8 ALEXANDRE ALMEIDA BEZERRA, 196 EDUARDO CARDOSO DUARTE
-- =============================================================================

UPDATE motoristas
SET is_deleted = false, deleted_at = NULL, deleted_by_usuario_id = NULL, deleted_by_nome = NULL
WHERE id IN (2, 3, 7, 8, 196) AND is_deleted IS TRUE;
