-- =============================================================================
-- MIGRATION 70 — Uso do veículo na escala (04/11/2026)
-- =============================================================================
-- Sai com a v7.1.1. RIN7G15 é exclusivo da carne (Tiago): não serve de substituto
-- na largada, então sai da Disponibilidade. Mesma regra de motoristas.uso_escala
-- (migration 69):
--   ROTA  escala e Disponibilidade (vazio vale como ROTA)
--   FIXA  serviço fixo, fora dos disponíveis; continua nas sugestões de placa
-- Sem NOT NULL nem CHECK de propósito: aparelho em versão antiga manda null no
-- lote do sync, e a recusa derrubaria o envio inteiro.
-- =============================================================================

ALTER TABLE veiculos ADD COLUMN IF NOT EXISTS uso_escala VARCHAR(12) DEFAULT 'ROTA';

UPDATE veiculos SET uso_escala = 'ROTA' WHERE uso_escala IS NULL;

UPDATE veiculos SET uso_escala = 'FIXA' WHERE upper(placa) = 'RIN7G15';
