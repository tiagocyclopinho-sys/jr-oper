-- =============================================================================
-- MIGRATION 66 — Setor do veículo (04/11/2026)
-- =============================================================================
-- Sai com a v7.0.0. Veículo do frio é refrigerado e não muda de setor (Tiago):
-- a Disponibilidade separa frio e seco para o substituto da largada ser do
-- setor certo. Editável em Cadastros Mestres.
--
-- Preenchido pelo setor das viagens desde 01/06/2026: nenhuma placa rodou nos
-- dois. Veículo sem viagem no período (passeio, utilitário) fica vazio.
-- Idempotente: só preenche quem está vazio.
-- =============================================================================

ALTER TABLE veiculos ADD COLUMN IF NOT EXISTS setor VARCHAR(10);

UPDATE veiculos v
SET setor = h.setor
FROM (
  SELECT upper(placa) placa, (array_agg(upper(setor) ORDER BY n DESC))[1] setor
  FROM (
    SELECT placa, setor, count(*) n FROM controle_viagens
    WHERE is_deleted IS NOT TRUE AND data_saida >= '2026-06-01' AND upper(coalesce(setor, '')) IN ('FRIO', 'SECO')
    GROUP BY placa, setor
  ) x
  GROUP BY upper(placa)
) h
WHERE upper(v.placa) = h.placa AND v.setor IS NULL;
