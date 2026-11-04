-- =============================================================================
-- MIGRATION 65 — Retorno das matrizes pelo histórico (04/11/2026)
-- =============================================================================
-- Os retornos vieram de "Horário Fechamento Rotas (2025.11)", e 91 das 94 linhas
-- estavam às 23:59. Decisão do Tiago: gravar direto pelo histórico, sem tela de
-- aprovação; quem organiza depois, na tela Matrizes, é o Luizinho.
--
-- Regra: viagens FINALIZADO com saída desde 01/09/2026 e retorno válido, por
-- rota (nome exato) e dia da semana. O retorno é o tempo em que 8 de cada 10
-- viagens voltaram, contado das 00:00 do dia da matriz e arredondado para cima
-- em meia hora. Linha com menos de 3 viagens fica como estava.
--
-- ROTA DE VÉSPERA: rota longa fecha e sai à tarde para entregar no dia seguinte,
-- em geral domingo e quarta. Saída depois das 12:00, sem a rota na matriz daquele
-- dia e com ela na matriz do dia seguinte, conta na matriz do dia seguinte.
--
-- Vale para as escalas montadas daqui em diante. Roda uma vez: rodar de novo
-- recalcula com o histórico daquele dia e pisa no que o Luizinho ajustou.
-- =============================================================================

WITH f AS (
  SELECT upper(v.rota) rota, v.data_saida::date ds, extract(isodow FROM v.data_saida::date)::int dow,
         left(v.hora_saida, 5) h, (v.data_retorno::date + nullif(v.hora_retorno, '')::time) real
  FROM controle_viagens v
  WHERE v.is_deleted IS NOT TRUE AND v.status_viagem = 'FINALIZADO'
    AND v.data_saida ~ '^\d{4}-\d{2}-\d{2}$' AND v.data_retorno ~ '^\d{4}-\d{2}-\d{2}$'
    AND v.hora_retorno ~ '^\d{2}:\d{2}' AND v.data_saida >= '2026-09-01' AND v.data_retorno >= v.data_saida
), m AS (
  SELECT id, upper(rota) rota, dia_semana dow FROM escala_matrizes
  WHERE coalesce(is_deleted, false) = false AND setor <> 'TRANSBORDO'
), a AS (
  SELECT f.*, CASE WHEN f.h >= '12:00'
      AND NOT EXISTS (SELECT 1 FROM m WHERE m.rota = f.rota AND m.dow = f.dow)
      AND EXISTS (SELECT 1 FROM m WHERE m.rota = f.rota AND m.dow = (CASE WHEN f.dow = 7 THEN 1 ELSE f.dow + 1 END))
    THEN f.ds + 1 ELSE f.ds END ancora
  FROM f
), s AS (
  SELECT m.id, count(a.ds) n,
         percentile_cont(0.8) WITHIN GROUP (ORDER BY extract(epoch FROM a.real - a.ancora::timestamp) / 3600) p80
  FROM m LEFT JOIN a ON a.rota = m.rota AND extract(isodow FROM a.ancora)::int = m.dow
  GROUP BY m.id
), n AS (
  SELECT id, ceil(p80 * 2) / 2 h FROM s WHERE n >= 3
)
UPDATE escala_matrizes e
SET retorno_dias = floor(n.h / 24)::int,
    retorno_hora = to_char(make_time(floor(n.h - floor(n.h / 24) * 24)::int, ((n.h - floor(n.h)) * 60)::int, 0), 'HH24:MI'),
    atualizado_por = 'HISTORICO VIAGENS 04/11',
    atualizado_em = now() AT TIME ZONE 'America/Sao_Paulo'
FROM n WHERE e.id = n.id;

-- Para consulta: valores ANTERIORES das linhas com retorno diferente de 0 dia 23:59
-- (id=dias/hora). As demais linhas alteradas estavam em 0 dia 23:59.
-- 14=0/18:00 1=1/23:59 2=2/23:59 10=1/18:00 3=2/23:59 4=1/23:59 13=1/23:59 15=1/23:59 16=1/23:59 5=1/23:59
-- 17=2/12:00 19=2/23:59 22=2/18:00 23=1/23:59 20=2/18:00 21=3/18:00 34=1/18:00 51=2/23:59 49=2/23:59 50=2/23:59
-- 58=1/23:59 57=1/23:59 75=1/23:59 71=1/23:59 59=1/23:59 74=1/23:59 55=1/23:59 56=1/23:59 66=1/23:59
