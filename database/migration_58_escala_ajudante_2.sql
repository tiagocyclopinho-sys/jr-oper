-- =============================================================================
-- MIGRATION 58 — 2º ajudante na escala (30/10/2026)
-- =============================================================================
-- Sai com a v6.11.0. Pedido do Tiago: matriz e convocação passam a ter o 2º
-- ajudante, como o Controle de Viagens já tem (controle_viagens.ajudante_2,
-- 6.6.0). O Importar Fusion grava o AJUDANTE 1 em ajudante e o AJUDANTE 2 (e
-- 3, 4, se vierem) em ajudante_2.
--
-- SEM conversão de dados aqui, de propósito: as planilhas traziam os dois
-- ajudantes num campo só ("KAUAN / EDSON"). A 6.11.0 separa isso na tela ao
-- carregar e grava separado na próxima edição. Separar no banco agora faria a
-- 6.10.0, ainda no ar até o deploy, mostrar só o 1º ajudante.
--
-- Idempotente.
-- =============================================================================

ALTER TABLE escala_matrizes ADD COLUMN IF NOT EXISTS ajudante_2 VARCHAR(160);
ALTER TABLE escala_linhas   ADD COLUMN IF NOT EXISTS ajudante_2 VARCHAR(160);
