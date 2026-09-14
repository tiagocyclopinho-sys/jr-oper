-- =============================================================================
-- MIGRATION 43 — retencoes_frota.descricao_acao_liberacao (10/09/2026)
-- =============================================================================
-- APLICADA EM PRODUCAO (projeto JR-OPER) em 10/09/2026.
--
-- O DEFEITO
--
-- O campo "Acao de Manutencao Realizada" e obrigatorio na liberacao de veiculo
-- desde a auditoria de 17/08/2026 (app.js:confirmarLiberacaoFrota valida antes
-- de chamar) e store.js:liberarVeiculo() grava o valor em
-- `descricao_acao_liberacao` — mas a coluna nunca foi criada no banco. Ela
-- existia so no JavaScript: nenhuma migration, nenhuma linha no schema.sql.
--
-- Consequencia, em cadeia:
--
--   1. Todo POST de retencoes_frota que carregasse uma liberacao voltava
--      PGRST204 ("Could not find the column ... in the schema cache").
--   2. O igualador de chaves de cloudStore.upsert() copia toda chave nova para
--      TODOS os objetos do lote (o PostgREST exige chaves iguais no array).
--      Entao UMA liberacao envenenava o lote inteiro da tabela.
--   3. _confirmarEnvio() so roda com o POST aceito. Os registros ficavam
--      "sujos" para sempre, retentando a cada 30s e falhando toda vez.
--   4. Na leitura, a regra de desempate de _mesclarPorRegistro() ("registro
--      sujo vence a nuvem") prendia cada aparelho a sua propria versao.
--
-- SINTOMA DE CAMPO
--
-- 10/09/2026: o PC da manutencao (LEONARDO MACHADO) mostrava 2 veiculos
-- LIBERADOS e o do analista (TIAGO FERREIRA ALVES) mostrava os mesmos 2
-- RETIDOS — RET-2026-001 (RSE9H43) e RET-2026-002 (RMC7H05). No banco, as
-- duas linhas estavam RETIDO, com data_liberacao e atualizado_em nulos: as
-- liberacoes nunca sairam do navegador de quem as fez. Nada acendeu na tela:
-- o indicador de nuvem ficou verde o tempo todo.
--
-- ORDEM DE APLICACAO (importa)
--
-- Esta migration sobe SOZINHA primeiro, com o codigo antigo ainda no ar. E o
-- que basta para a recuperacao: os registros continuam marcados como sujos no
-- aparelho da manutencao, entao o proximo ciclo de sync sobe as liberacoes por
-- conta propria, sem ninguem redigitar nada. So DEPOIS de confirmar que as
-- liberacoes chegaram e que se publica a lista branca de retencoes_frota em
-- cloudStore.COLUNAS_POR_TABELA — ela muda o calculo do hash da tabela e
-- marcaria TODA retencao de TODO aparelho como suja de uma vez, abrindo uma
-- janela em que um aparelho com a versao velha poderia empurrar RETIDO por
-- cima do LIBERADO recem-chegado.
-- =============================================================================

ALTER TABLE retencoes_frota
  ADD COLUMN IF NOT EXISTS descricao_acao_liberacao TEXT;

COMMENT ON COLUMN retencoes_frota.descricao_acao_liberacao IS
  'Acao de manutencao realizada, informada obrigatoriamente na liberacao do veiculo.';

-- Conferencia
-- SELECT numero_retencao, placa, status, data_liberacao, descricao_acao_liberacao
--   FROM retencoes_frota ORDER BY criado_em DESC;
