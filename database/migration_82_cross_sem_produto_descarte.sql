-- =============================================================================
-- MIGRATION 82 — Cross Palmas: item sem produto físico e descarte no cross
-- (21/11/2026, sai com a v7.7.0)
-- =============================================================================
-- Achado da DEV-296 (TAQUARALTO, inversão do motorista): um item era FALTA
-- (24 margarinas que nunca existiram fisicamente) e outro SOBRA (1 un. que
-- volta). O Cross só sabia "chegou e volta", então as 24 entraram como
-- estoque em Palmas esperando transbordo.
--
-- Decisões do Tiago em 21/11:
--   SEM_PRODUTO — item sem produto para voltar (falta, inversão, renegociado
--                 em rota). Não entra no estoque nem no transbordo; o CD
--                 fecha sem esperar Palmas. Item com motivo FALTA já vem
--                 marcado assim na tela.
--   DESCARTE    — avaria descartada em Palmas, com FOTO obrigatória e quem
--                 autorizou. Sai do estoque do cross; o CD fecha o item como
--                 Avaria/Descarte.
--
-- fotos_paths: caminhos no bucket devolucoes-fotos (pasta cross/), como nos
-- demais módulos. autorizado_por: texto livre (quem liberou o descarte).
--
-- Idempotente.
-- =============================================================================

ALTER TABLE cross_movimentos ADD COLUMN IF NOT EXISTS autorizado_por VARCHAR(120);
ALTER TABLE cross_movimentos ADD COLUMN IF NOT EXISTS fotos_paths    JSONB;

ALTER TABLE cross_movimentos DROP CONSTRAINT IF EXISTS ck_cross_movimentos_tipo;
ALTER TABLE cross_movimentos ADD  CONSTRAINT ck_cross_movimentos_tipo
  CHECK (tipo IN ('RECEBIDO_CROSS', 'EMBARQUE', 'SEM_PRODUTO', 'DESCARTE'));
