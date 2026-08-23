-- =====================================================================
-- DETECTOR DE REGISTRO SEMEADO / IMPORTADO — 23/08/2026
--
-- Acha, no banco inteiro e de uma vez, registros cujo `id` NAO foi gerado
-- pelo app no momento em que o registro diz ter sido criado.
--
-- POR QUE ISSO FUNCIONA
-- O `id` deste sistema e relogio, em dois formatos (ver _momentoDoRegistro
-- em js/cloudStore.js):
--     id > 1e14  ->  gerarIdUnico() = Date.now() * 1000 + contador
--     id > 1e11  ->  Date.now() puro (formato usado ate 20/08/2026)
-- Num registro criado de verdade, o relogio embutido no id e a data que o
-- registro carrega vem do MESMO instante e batem. Quando nao batem, o id
-- foi escrito por outra coisa que nao um lancamento: semeadura de demo,
-- importacao, ou insercao manual.
--
-- Foi assim que se identificaram, em 23/08/2026, duas reentregas com id
-- 1718000000001 e 1718000000002 - redondos, sequenciais, e cujo relogio
-- decodifica para 10/06/2024 enquanto a linha se diz de 14/08/2026.
--
-- CORRECAO 23/08/2026: a primeira versao usava data_abertura/data_chamado,
-- que NAO existem no banco (erro 42703). Sao nomes que so existem dentro do
-- app, no objeto JavaScript. No banco, a data de criacao e `criado_em` em
-- todas as tres tabelas - conferido em database/schema.sql.
--
-- LEITURA PURA. Nao altera nada. Rode no SQL Editor do Supabase.
-- =====================================================================

WITH decodificado AS (
  SELECT 'reentregas_rota'::text AS tabela, id,
         -- esta tabela tem a data do fato numa coluna propria (`data`);
         -- as outras duas so tem `criado_em`
         COALESCE(data::timestamp, criado_em) AS data_do_registro,
         carga_numero AS referencia, placa AS complemento, is_deleted
    FROM reentregas_rota
  UNION ALL
  SELECT 'ocorrencias_devolucao', id, criado_em,
         carga_numero, veiculo_placa, is_deleted
    FROM ocorrencias_devolucao
  UNION ALL
  SELECT 'ocorrencias_rota', id, criado_em,
         numero_protocolo, NULL, is_deleted
    FROM ocorrencias_rota
),
comparado AS (
  SELECT
    tabela, id, referencia, complemento, data_do_registro,
    -- o instante que esta DENTRO do id, pela mesma regra do app
    to_timestamp(
      CASE WHEN id > 100000000000000 THEN (id / 1000) / 1000.0
           WHEN id > 100000000000    THEN  id        / 1000.0
      END
    ) AT TIME ZONE 'UTC' AS relogio_do_id
  FROM decodificado
  WHERE is_deleted IS NOT TRUE
    AND data_do_registro IS NOT NULL
    AND id > 100000000000          -- ids pequenos nao sao relogio: ignorar
)
SELECT
  tabela,
  id,
  referencia,
  complemento,
  data_do_registro::date  AS data_que_o_registro_diz,
  relogio_do_id::date     AS data_embutida_no_id,
  abs(EXTRACT(EPOCH FROM (relogio_do_id - data_do_registro)) / 86400)::int
                          AS dias_de_diferenca
FROM comparado
-- Mais de 2 dias de diferenca nao acontece num lancamento real: o id e a
-- data nascem do mesmo Date.now(). A folga existe so para fuso horario e
-- para o lancamento feito no dia seguinte ao fato.
WHERE abs(EXTRACT(EPOCH FROM (relogio_do_id - data_do_registro))) > 2 * 86400
ORDER BY dias_de_diferenca DESC, tabela, id;

-- =====================================================================
-- COMO LER O RESULTADO
--
--   "Success. No rows returned"
--       Nada semeado no banco. Pode seguir para o Reset Global.
--
--   linhas com `dias_de_diferenca` na casa das centenas
--       Registro semeado/importado. Confira o `id`: redondo e sequencial
--       (...001, ...002) confirma. Some no Reset Global e NAO volta -
--       nenhum caminho do codigo atual gera id nesse formato (todos usam
--       gerarIdUnico()). Nao precisa de tratamento a parte.
--
--   linhas com diferenca de poucos dias
--       Provavelmente lancamento retroativo legitimo - alguem registrou
--       hoje um fato de tres dias atras. Confira um pelo protocolo antes
--       de concluir qualquer coisa.
--
-- Rode DE NOVO depois do Reset Global. Se voltar a aparecer linha, algum
-- aparelho esta republicando cache antigo: ache qual em Governanca ->
-- Aparelhos, e use a PARTE 4 do CONFERIR_APARELHO.md.
-- =====================================================================
