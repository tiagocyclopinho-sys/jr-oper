-- =============================================================================
-- MIGRATION 29 - DEFAULT DAS COLUNAS TIMESTAMP EM HORARIO DE BRASILIA
--
-- JA APLICADA no projeto qxipgnkdbzxtfvuyupow em 25/08/2026 (25 colunas
-- ajustadas). Este arquivo espelha o que foi feito.
--
-- O PROBLEMA
-- As colunas sao TIMESTAMP WITHOUT TIME ZONE - o tipo diz "sem fuso". Mesmo
-- assim guardavam UTC: o app gravava com new Date().toISOString() e o DEFAULT
-- era CURRENT_TIMESTAMP, com o servidor Supabase em UTC.
--
-- Guardar UTC numa coluna "sem fuso" faz o valor depender de uma convencao que
-- quem consome nao conhece. E ha consumidor que nao conhece:
--
--     schema_views.sql:71   o.criado_em AS data_abertura
--     schema_views.sql:93   od.criado_em AS data_chamado
--
-- As views entregam o carimbo CRU para o Power BI. Uma correcao feita so no
-- JavaScript nao alcanca relatorio nenhum.
--
-- Como o Brasil e UTC-3, depois das 21h a data virava a do dia seguinte. Isso
-- batia so no 3o turno do CD - o turno com menos gente por perto para conferir,
-- que e o que torna esse tipo de defeito caro.
--
-- O QUE ESTA MIGRATION FAZ
-- Alinha o DADO ao TIPO para toda linha inserida pelo BANCO (import SQL,
-- insercao manual, trigger). O app passa a gravar em Brasilia na mesma versao
-- (v5.0.0), via agoraIsoBrasilia() em js/config.js.
--
-- O QUE ELA NAO FAZ, DE PROPOSITO
-- Nao converte as linhas ja existentes. No momento da aplicacao eram ~20 linhas
-- de treinamento, todas criadas entre 10h e 15h BRT, cujas DATAS ja estavam
-- certas - so o horario aparece 3h adiantado nelas. Reescrever dado de producao
-- para ganho cosmetico nao se paga. Se um dia for necessario:
--     UPDATE <tabela> SET <coluna> = <coluna> - interval '3 hours';
--
-- Nao mexe nas 12 colunas TIMESTAMP WITH TIME ZONE: guardam o instante com
-- fuso e ja estao corretas por construcao.
-- =============================================================================
DO $$
DECLARE col RECORD;
BEGIN
  FOR col IN
    SELECT c.table_name AS tbl, c.column_name AS cln
    FROM information_schema.columns c
    JOIN information_schema.tables t
      ON t.table_schema = c.table_schema AND t.table_name = c.table_name
    WHERE c.table_schema = 'public'
      AND c.data_type = 'timestamp without time zone'
      AND t.table_type = 'BASE TABLE'
      AND c.column_default IS NOT NULL
      AND (c.column_default ILIKE '%CURRENT_TIMESTAMP%' OR c.column_default ILIKE '%now()%')
  LOOP
    EXECUTE format(
      'ALTER TABLE %I ALTER COLUMN %I SET DEFAULT (NOW() AT TIME ZONE ''America/Sao_Paulo'')',
      col.tbl, col.cln
    );
    RAISE NOTICE 'default ajustado: %.%', col.tbl, col.cln;
  END LOOP;
END $$;

-- Conferencia (esperado: 25 no momento em que foi aplicada):
-- SELECT count(*) FROM information_schema.columns
--  WHERE table_schema='public' AND column_default ILIKE '%America/Sao_Paulo%';
