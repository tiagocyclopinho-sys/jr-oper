-- =============================================================================
-- MIGRATION 57 — Transbordo na escala (30/10/2026)
-- =============================================================================
-- Sai com a v6.11.0. Pedido do Tiago: o veículo que sai do CD de Araguaína e
-- faz o cross-docking em Palmas (ou Marabá), QUANDO É NOSSO, entra na escala e
-- no Controle de Viagens. Terceiro não interessa: continua só como observação.
--
--   setor = 'TRANSBORDO' — a linha do caminhão do transbordo (rota = destino
--                          do cross-docking, ex.: TRANSBORDO PALMAS).
--   transbordo_id        — na linha de uma ROTA: a linha de transbordo que leva
--                          a carga dela até o cross-docking. Na matriz aponta
--                          para outra linha da matriz; na escala, para outra
--                          linha da escala.
--
-- A observação amarela da imagem ("ARMANDO - RSC7E69") passa a ser montada pelo
-- app a partir do transbordo; por isso a conversão abaixo limpa a observação
-- das rotas convertidas.
--
-- Conversão das matrizes (células mescladas das planilhas de 30/10/2026):
--   Segunda: ARMANDO RSC7E69  -> PALMAS NORTE, PALMAS SUL, TAQUARALTO
--            ANDERSON RSD8J69 -> PALMEIRÓPOLIS, DIANÓPOLIS
--            ADEMAR RMC7H72   -> PORTO / NATIVIDADE, PARAÍSO DO TOCANTINS
--   Sexta:   ARMANDO RSC7E69  -> PALMAS NORTE, PALMAS SUL, TAQUARALTO, PARAÍSO
-- Ficaram como observação: "JHONATA - RSE9G00" (Marabá I e II, mesma placa da
-- própria rota) e "DIOGENES - RMC7H05" (Porto Nacional de sexta, mesma placa).
--
-- Idempotente.
-- =============================================================================

ALTER TABLE escala_matrizes ADD COLUMN IF NOT EXISTS transbordo_id BIGINT;
ALTER TABLE escala_linhas   ADD COLUMN IF NOT EXISTS transbordo_id BIGINT;

ALTER TABLE escala_matrizes DROP CONSTRAINT IF EXISTS ck_escala_matrizes_setor;
ALTER TABLE escala_matrizes ADD CONSTRAINT ck_escala_matrizes_setor CHECK (setor IN ('FRIO', 'SECO', 'TRANSBORDO'));
ALTER TABLE escala_linhas DROP CONSTRAINT IF EXISTS ck_escala_linhas_setor;
ALTER TABLE escala_linhas ADD CONSTRAINT ck_escala_linhas_setor CHECK (setor IN ('FRIO', 'SECO', 'TRANSBORDO'));

INSERT INTO escala_matrizes
  (id, dia_semana, setor, ordem, rota, placa, motorista, ajudante, observacao, retorno_dias, retorno_hora, criado_por, criado_em)
VALUES
  (95, 1, 'TRANSBORDO', 1, 'TRANSBORDO PALMAS', 'RSC7E69', 'ARMANDO LIMA DA CUNHA', NULL, NULL, 0, '23:59', 'MIGRATION 57', now()),
  (96, 1, 'TRANSBORDO', 2, 'TRANSBORDO PALMAS', 'RSD8J69', 'ANDERSON JUNIOR ALVES LIMA', NULL, NULL, 0, '23:59', 'MIGRATION 57', now()),
  (97, 1, 'TRANSBORDO', 3, 'TRANSBORDO PALMAS', 'RMC7H72', 'ADEMAR FILHO DE OLIVEIRA', NULL, NULL, 0, '23:59', 'MIGRATION 57', now()),
  (98, 5, 'TRANSBORDO', 1, 'TRANSBORDO PALMAS', 'RSC7E69', 'ARMANDO LIMA DA CUNHA', NULL, NULL, 0, '23:59', 'MIGRATION 57', now())
ON CONFLICT (id) DO NOTHING;

UPDATE escala_matrizes SET transbordo_id = 95 WHERE id IN (6, 7, 8)     AND transbordo_id IS NULL;
UPDATE escala_matrizes SET transbordo_id = 96 WHERE id IN (9, 10)       AND transbordo_id IS NULL;
UPDATE escala_matrizes SET transbordo_id = 97 WHERE id IN (11, 12)      AND transbordo_id IS NULL;
UPDATE escala_matrizes SET transbordo_id = 98 WHERE id IN (80, 81, 82, 83) AND transbordo_id IS NULL;
UPDATE escala_matrizes
   SET observacao = NULL, atualizado_por = 'MIGRATION 57', atualizado_em = (now() AT TIME ZONE 'America/Sao_Paulo')
 WHERE id IN (6, 9, 11, 80)
   AND observacao IN ('ARMANDO - RSC7E69', 'ANDERSON - RSD8J69', 'ADEMAR - RMC7H72');
