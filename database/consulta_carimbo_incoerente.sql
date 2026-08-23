-- =====================================================================
-- DETECTOR DE REGISTRO SEMEADO / IMPORTADO — 23/08/2026
--
-- Acha, no banco inteiro e de uma vez, registros cujo `id` NÃO foi gerado
-- pelo app no momento em que o registro diz ter sido criado.
--
-- POR QUE ISSO FUNCIONA
-- O `id` deste sistema é relógio, em dois formatos (ver _momentoDoRegistro
-- em js/cloudStore.js):
--     id > 1e14  ->  gerarIdUnico() = Date.now() * 1000 + contador
--     id > 1e11  ->  Date.now() puro (formato usado até 20/08/2026)
-- Num registro criado de verdade, o relógio embutido no id e a data que o
-- registro carrega vêm do MESMO instante e batem. Quando não batem, o id
-- foi escrito por outra coisa que não um lançamento: semeadura de demo,
-- importação, ou inserção manual.
--
-- Foi assim que se identificaram, em 23/08/2026, duas reentregas com id
-- 1718000000001 e 1718000000002 — redondos, sequenciais, e cujo relógio
-- decodifica para 10/06/2024 enquanto a linha se diz de 14/08/2026.
--
-- LEITURA PURA. Não altera nada. Rode no SQL Editor do Supabase.
-- =====================================================================

WITH decodificado AS (
  SELECT 'reentregas_rota' AS tabela, id, data::timestamp AS data_do_registro,
         carga_numero AS referencia, placa AS complemento, is_deleted
    FROM reentregas_rota
  UNION ALL
  SELECT 'ocorrencias_devolucao', id, data_abertura::timestamp,
         carga_numero, veiculo_placa, is_deleted
    FROM ocorrencias_devolucao
  UNION ALL
  SELECT 'ocorrencias_rota', id, data_chamado::timestamp,
         carga_rota, veiculo_placa, is_deleted
    FROM ocorrencias_rota
),
comparado AS (
  SELECT
    tabela,
    id,
    referencia,
    complemento,
    data_do_registro,
    -- o instante que está DENTRO do id, pela mesma regra do app
    to_timestamp(
      CASE WHEN id > 100000000000000 THEN (id / 1000) / 1000.0
           WHEN id > 100000000000    THEN  id        / 1000.0
      END
    ) AT TIME ZONE 'UTC' AS relogio_do_id
  FROM decodificado
  WHERE is_deleted IS NOT TRUE
    AND id > 100000000000          -- ids pequenos não são relógio: ignorar
)
SELECT
  tabela,
  id,
  referencia,
  complemento,
  data_do_registro::date       AS data_que_o_registro_diz,
  relogio_do_id::date          AS data_embutida_no_id,
  abs(EXTRACT(EPOCH FROM (relogio_do_id - data_do_registro)) / 86400)::int
                               AS dias_de_diferenca
FROM comparado
-- Mais de 2 dias de diferença não acontece num lançamento real: o id e a
-- data nascem do mesmo Date.now(). A folga existe só para fuso e para o
-- lançamento feito no dia seguinte ao fato.
WHERE abs(EXTRACT(EPOCH FROM (relogio_do_id - data_do_registro))) > 2 * 86400
ORDER BY dias_de_diferenca DESC, tabela, id;

-- COMO LER O RESULTADO
--
--   nenhuma linha
--       Nada semeado no banco. Pode seguir para o Reset Global.
--
--   linhas com `dias_de_diferenca` na casa das centenas
--       Registro semeado/importado. Confira o `id`: redondo e sequencial
--       (…001, …002) confirma. Some no Reset Global e NÃO volta — nenhum
--       caminho do código atual gera id nesse formato (todos usam
--       gerarIdUnico()). Não precisa de tratamento à parte.
--
--   linhas com diferença de poucos dias
--       Provavelmente lançamento retroativo legítimo — alguém registrou
--       hoje um fato de três dias atrás. Confira um pelo protocolo antes
--       de concluir qualquer coisa.
--
-- Rode DE NOVO depois do Reset Global. Se voltar a aparecer linha, algum
-- aparelho está republicando cache antigo: ache qual em Governança →
-- Aparelhos, e use a PARTE 4 do CONFERIR_APARELHO.md.
