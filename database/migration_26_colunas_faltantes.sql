-- =============================================================================
-- MIGRACAO 26 - COLUNAS FALTANTES E COLUNA GERADA (22/08/2026)
--
-- SINTOMA: quatro tabelas paradas em tabelasComPendencia, com dado gravado
-- apenas no aparelho e nao compartilhado:
--   ocorrencias_rota   HTTP 400  23514  (CHECK tipo_ocorrencia)
--   ocorrencias_viagens HTTP 400 PGRST204 (coluna "status")
--   itens_devolucao    HTTP 400  PGRST204 (coluna "data_validade")
--   sinistros          HTTP 409  23503  (FK -> ocorrencias_rota)
--
-- METODO: em vez de consertar coluna a coluna (PGRST204 so reporta uma por
-- vez, o que vira um ciclo infinito), o levantamento foi exaustivo: as
-- chaves que o app grava em jr_sac_db, comparadas com information_schema
-- das 25 tabelas do sync. Resultado: SO 4 colunas faltam em todo o sistema.
--
-- O CHECK de ocorrencias_rota NAO se conserta aqui - e conserto de app,
-- na 4.8.1 (o app gravava o vocabulario de motivo_resumido dentro de
-- tipo_ocorrencia). Ver store.js addOcorrenciaRota/updateOcorrenciaRota.
--
-- Rode este arquivo inteiro no SQL Editor do Supabase. E idempotente.
-- =============================================================================

BEGIN;

-- -----------------------------------------------------------------------
-- 26.1  ocorrencias_viagens.status
--
-- A tela de criacao passa status ('PENDENTE'/'FINALIZADA'), mas
-- addOcorrenciaViagem() monta o registro com lista fixa de campos e
-- descarta o status - por isso CRIAR funcionava. Ja updateOcorrenciaViagem()
-- faz Object.assign sem filtro, entao FINALIZAR uma ocorrencia injetava a
-- chave e travava a tabela inteira (o POST do PostgREST e uma transacao so:
-- um registro ruim derruba o lote todo, inclusive os validos).
--
-- SEM CHECK, de proposito. Um CHECK sobre vocabulario que o app nao
-- respeita e exatamente o mecanismo que produziu os 247 fantasmas em
-- data_saida e o 23514 de ocorrencias_rota. O app e o unico escritor.
-- -----------------------------------------------------------------------
ALTER TABLE ocorrencias_viagens ADD COLUMN IF NOT EXISTS status VARCHAR(20);

-- -----------------------------------------------------------------------
-- 26.2  itens_devolucao - fluxo de destinacao do CD
--
-- updateDestinoCd() (store.js) grava cinco campos que nunca existiram na
-- tabela. Tres apareceram no levantamento deste aparelho; status_negociacao
-- e data_negociacao ainda nao porque nenhum item passou por negociacao
-- aqui - mas updateItemNegociacao() os grava, entao entram junto. Melhor
-- do que descobrir na proxima vez que alguem negociar um item.
--
-- data_validade e VARCHAR(20), nao DATE: para AVARIA_DESCARTE e
-- RENEGOCIADO_ROTA o app grava string vazia de proposito (a validacao da
-- tela dispensa a data nesses dois destinos), e DATE recusa ''. Fica
-- registrado como divida: quando nao houver mais '' no cache de nenhum
-- aparelho, da para apertar para DATE.
-- -----------------------------------------------------------------------
ALTER TABLE itens_devolucao ADD COLUMN IF NOT EXISTS data_validade     VARCHAR(20);
ALTER TABLE itens_devolucao ADD COLUMN IF NOT EXISTS destino_item      VARCHAR(40);
ALTER TABLE itens_devolucao ADD COLUMN IF NOT EXISTS observacao        TEXT;
ALTER TABLE itens_devolucao ADD COLUMN IF NOT EXISTS status_negociacao VARCHAR(30);
ALTER TABLE itens_devolucao ADD COLUMN IF NOT EXISTS data_negociacao   TIMESTAMPTZ;

-- -----------------------------------------------------------------------
-- 26.3  itens_devolucao.valor_total - a armadilha seguinte
--
-- valor_total e GENERATED ALWAYS AS (quantidade * valor_unitario) STORED.
-- O app carrega valor_total dentro do registro e o manda no POST. Postgres
-- recusa escrita em coluna gerada (SQLSTATE 428C9). Isso ainda NAO tinha
-- aparecido porque o PGRST204 de data_validade barra antes, no cache de
-- schema do PostgREST - o erro nem chega ao banco. Sem este item, a tabela
-- destravaria de 26.2 e voltaria a travar no ciclo seguinte.
--
-- DROP EXPRESSION preserva os valores ja calculados e torna a coluna
-- escrivel. O calculo continua correto porque quem monta o item no app ja
-- grava quantidade * valor_unitario no mesmo campo.
-- -----------------------------------------------------------------------
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema = 'public'
       AND table_name   = 'itens_devolucao'
       AND column_name  = 'valor_total'
       AND is_generated = 'ALWAYS'
  ) THEN
    ALTER TABLE itens_devolucao ALTER COLUMN valor_total DROP EXPRESSION;
  END IF;
END $$;

-- -----------------------------------------------------------------------
-- 26.4  sinistros - NAO mexemos nas FKs por enquanto
--
-- O 23503 de sinistros e consequencia, nao causa: o sinistro aponta
-- ocorrencia_rota_id para uma ocorrencia que nunca chegou na nuvem, porque
-- ocorrencias_rota estava barrada pelo CHECK. Como ocorrencias_rota e
-- enviada ANTES de sinistros (cloudStore.js, ordem do array mappings),
-- assim que a 4.8.1 destravar a primeira, a FK da segunda encontra o pai
-- e resolve sozinha.
--
-- Vale notar: a migration_22 derrubou praticamente todas as FKs do schema
-- justamente porque a sincronizacao nao tem como honra-las. sinistros ficou
-- como uma das ultimas com integridade referencial - e por isso e a unica
-- cuspindo 23503.
--
-- SO SE sobrar sinistro orfao depois do deploy 4.8.1 (apontando para uma
-- ocorrencia excluida no aparelho, que nunca vai existir na nuvem),
-- descomente o bloco abaixo. Ai fica coerente com o resto do sistema em
-- vez de ser a excecao.
--
-- ALTER TABLE sinistros DROP CONSTRAINT IF EXISTS sinistros_ocorrencia_rota_id_fkey;
-- ALTER TABLE sinistros DROP CONSTRAINT IF EXISTS sinistros_veiculo_id_fkey;
-- ALTER TABLE sinistros DROP CONSTRAINT IF EXISTS sinistros_motorista_id_fkey;

COMMIT;

-- =============================================================================
-- CONFERENCIA - rode DEPOIS, separado. Esperado: 1, 1, 1, 1, 1, 1, 0
-- =============================================================================
-- SELECT
--   (SELECT count(*) FROM information_schema.columns
--     WHERE table_name='ocorrencias_viagens' AND column_name='status')            AS ocv_status,
--   (SELECT count(*) FROM information_schema.columns
--     WHERE table_name='itens_devolucao' AND column_name='data_validade')         AS itd_validade,
--   (SELECT count(*) FROM information_schema.columns
--     WHERE table_name='itens_devolucao' AND column_name='destino_item')          AS itd_destino,
--   (SELECT count(*) FROM information_schema.columns
--     WHERE table_name='itens_devolucao' AND column_name='observacao')            AS itd_obs,
--   (SELECT count(*) FROM information_schema.columns
--     WHERE table_name='itens_devolucao' AND column_name='status_negociacao')     AS itd_negoc,
--   (SELECT count(*) FROM information_schema.columns
--     WHERE table_name='itens_devolucao' AND column_name='data_negociacao')       AS itd_data_negoc,
--   (SELECT count(*) FROM information_schema.columns
--     WHERE table_schema='public' AND is_generated <> 'NEVER')                    AS colunas_geradas;
