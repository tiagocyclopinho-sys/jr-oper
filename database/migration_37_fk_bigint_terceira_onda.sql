-- =============================================================================
-- MIGRACAO 37 - TERCEIRA ONDA DO "integer out of range" (01/09/2026)
--
-- O ERRO QUE ISTO FECHA, copiado do console de um aparelho de producao:
--
--   {tabela: 'itens_devolucao', status: 400,
--    detalhe: 'value "1787514068461840" is out of range for type integer'}
--
-- E a MESMA falha ja corrigida duas vezes (secao 10.5 do schema.sql, em
-- 19/08/2026, e secao 10.6, em 20/08/2026), numa terceira leva de colunas que
-- as duas primeiras nao alcancaram. O app gera id no cliente com
-- gerarIdUnico() = Date.now() * 1000 + contador, hoje na casa de 1,78e15. O
-- INTEGER de 32 bits do Postgres para em 2.147.483.647.
--
-- O QUE AS DUAS ONDAS ANTERIORES DEIXARAM PASSAR. Elas corrigiram as chaves
-- PRIMARIAS e as FKs de negocio (carga_id, cliente_id, produto_id...). Ficaram
-- para tras as colunas que ninguem lista quando pensa em "chave estrangeira",
-- porque elas nao aparecem em formulario nenhum:
--
--   deleted_by_usuario_id   quem apagou o registro -> usuarios.id  (BIGINT)
--   setor_id / setor_encaminhado_id                 -> setores.id  (BIGINT)
--
-- As duas apontam para tabelas cujo id JA e BIGINT. Ou seja, o banco estava
-- com a coluna que REFERENCIA mais estreita do que a coluna REFERENCIADA — um
-- estado em que a FK e satisfeita hoje e impossivel de satisfazer amanha.
--
-- POR QUE ISSO DEMOROU A APARECER, e por que aparece em UM aparelho so: a
-- coluna deleted_by_usuario_id so e preenchida quando alguem APAGA um
-- registro. Enquanto ninguem apaga uma devolucao, a tabela sincroniza a vida
-- inteira sem erro. Na primeira exclusao, o POST daquele lote passa a levar um
-- id de usuario de 16 digitos e o PostgREST devolve 400 — e como o envio e por
-- LOTE, o lote inteiro para. E por isso que o sintoma nao se parece com
-- "excluir esta quebrado": se parece com uma maquina que "esta diferente das
-- outras", inclusive do proprio celular de quem a usa. As linhas ficam presas
-- naquele aparelho, visiveis so para ele, e o log do ciclo repete
-- "N registro(s) local(is) preservado(s) por terem mudanca nao enviada".
--
-- NAO APAGUE O localStorage DA MAQUINA AFETADA ANTES DE RODAR ISTO. Os
-- registros presos existem SO ali — nunca chegaram na nuvem, entao nao ha copia
-- em lugar nenhum. Rode esta migracao primeiro; no ciclo seguinte o aparelho
-- sobe sozinho o que estava retido e a divergencia acaba sem intervencao.
--
-- Rode este arquivo inteiro no SQL Editor do Supabase. E idempotente:
-- ALTER COLUMN TYPE de BIGINT para BIGINT nao da erro.
--
-- DEPOIS DELE, RODE database/schema_views.sql — obrigatorio. Duas views de BI
-- dependem de colunas alteradas aqui e precisam ser derrubadas antes do ALTER
-- (Postgres recusa com "cannot alter type of a column used by a view or
-- rule"). O schema_views.sql recria as seis, com DROP IF EXISTS + CREATE OR
-- REPLACE, entao rodar de novo e seguro.
-- =============================================================================

BEGIN;

-- -----------------------------------------------------------------------
-- 37.1  AS VIEWS QUE TRAVAM O ALTER
--
-- Levantadas do banco por pg_depend, e nao por tentativa e erro:
--   vw_bi_produtividade_equipe   -> usuarios.setor_id
--   vw_bi_devolucoes_causa_raiz  -> ocorrencias_devolucao.setor_encaminhado_id
-- As outras quatro views de BI nao tocam nenhuma coluna desta migracao e
-- ficam de pe.
-- -----------------------------------------------------------------------
DROP VIEW IF EXISTS vw_bi_produtividade_equipe CASCADE;
DROP VIEW IF EXISTS vw_bi_devolucoes_causa_raiz CASCADE;

-- -----------------------------------------------------------------------
-- 37.2  QUEM APAGOU O REGISTRO -> usuarios.id (BIGINT)
--
-- itens_devolucao e ocorrencias_devolucao sao as duas que ja estao falhando
-- em producao. As outras seis entram junto porque sao a mesma coluna, com a
-- mesma origem e o mesmo destino: deixar qualquer uma de fora e agendar a
-- quarta onda desta migracao para o dia em que alguem apagar um veiculo.
-- -----------------------------------------------------------------------
ALTER TABLE itens_devolucao       ALTER COLUMN deleted_by_usuario_id TYPE BIGINT;
ALTER TABLE ocorrencias_devolucao ALTER COLUMN deleted_by_usuario_id TYPE BIGINT;
ALTER TABLE ocorrencias_rota      ALTER COLUMN deleted_by_usuario_id TYPE BIGINT;
ALTER TABLE cargas                ALTER COLUMN deleted_by_usuario_id TYPE BIGINT;
ALTER TABLE motoristas            ALTER COLUMN deleted_by_usuario_id TYPE BIGINT;
ALTER TABLE ajudantes             ALTER COLUMN deleted_by_usuario_id TYPE BIGINT;
ALTER TABLE veiculos              ALTER COLUMN deleted_by_usuario_id TYPE BIGINT;
ALTER TABLE trocas_veiculos       ALTER COLUMN deleted_by_usuario_id TYPE BIGINT;

-- -----------------------------------------------------------------------
-- 37.3  SETOR -> setores.id (BIGINT)
--
-- setores.id virou BIGINT na secao 10.6, mas as duas colunas que apontam
-- para ele ficaram INTEGER. Ainda nao estouraram porque os setores atuais
-- foram cadastrados com id pequeno; o primeiro setor criado pelo app (que
-- usa gerarIdUnico()) derruba o envio das duas tabelas.
-- -----------------------------------------------------------------------
ALTER TABLE usuarios                ALTER COLUMN setor_id             TYPE BIGINT;
ALTER TABLE ocorrencias_devolucao   ALTER COLUMN setor_encaminhado_id TYPE BIGINT;
ALTER TABLE auditoria_produtividade ALTER COLUMN setor_id             TYPE BIGINT;

-- -----------------------------------------------------------------------
-- 37.4  O QUE FICA DE FORA, DE PROPOSITO
--
-- sync_control.id continua INTEGER. E a unica coluna INTEGER que sobra no
-- banco, e ela nao tem o problema: sync_control e uma tabela de controle com
-- uma linha fixa, cujo id e gerado pelo PROPRIO Postgres. O app nunca escreve
-- id nela — so le o carimbo de reset. Nao ha id de cliente para estourar.
-- -----------------------------------------------------------------------

COMMIT;

-- -----------------------------------------------------------------------
-- CONFERENCIA. Depois do COMMIT, esta consulta tem de devolver UMA linha
-- (sync_control.id) e mais nenhuma. Qualquer outra linha e coluna que ainda
-- vai estourar.
-- -----------------------------------------------------------------------
-- SELECT table_name, column_name, data_type
--   FROM information_schema.columns
--  WHERE table_schema = 'public'
--    AND data_type IN ('integer','smallint')
--    AND (column_name = 'id' OR column_name LIKE '%\_id')
--  ORDER BY table_name, column_name;
