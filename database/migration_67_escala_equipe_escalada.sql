-- =============================================================================
-- MIGRATION 67 — Quem estava escalado (04/11/2026)
-- =============================================================================
-- Sai com a v7.0.0. Troca feita no Controle de Viagens (motorista passou mal, por
-- exemplo) agora vai para a linha da escala: o Fechamento mostra quem fez a
-- viagem. Estas colunas guardam quem estava escalado antes da primeira troca,
-- para o Fechamento mostrar "escalado: NOME" e a conferência com o WinThor.
-- Vazias enquanto não houver troca. Idempotente.
-- =============================================================================

ALTER TABLE escala_linhas ADD COLUMN IF NOT EXISTS motorista_escalado VARCHAR(160);
ALTER TABLE escala_linhas ADD COLUMN IF NOT EXISTS ajudante_escalado VARCHAR(160);
ALTER TABLE escala_linhas ADD COLUMN IF NOT EXISTS ajudante_2_escalado VARCHAR(160);
ALTER TABLE escala_linhas ADD COLUMN IF NOT EXISTS placa_escalada VARCHAR(10);
