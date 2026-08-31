-- =============================================================================
-- MIGRATION 36 - SINCRONIZACAO DO CATALOGO (CLIENTES E PRODUTOS)  31/08/2026
--
-- O QUE ESTA QUEBRADO HOJE
--
-- Cliente e produto cadastrados pela tela do app NAO chegam nos outros
-- aparelhos. As tabelas `clientes` e `produtos` existem, estao populadas com
-- as 15.139 + 4.010 linhas da planilha Dados SAC, e nunca estiveram no
-- MAPA_TABELAS do js/cloudStore.js - ou seja, nenhum aparelho jamais enviou
-- nem leu nenhuma das duas.
--
-- POR QUE NUNCA ENTRARAM. Porque sincronizar essas duas tabelas do jeito que
-- as outras 25 sincronizam significaria ler a TABELA INTEIRA a cada ciclo de
-- 30 segundos: ~2,5 MB de clientes mais ~0,5 MB de produtos, por aparelho,
-- por ciclo, para propagar meia duzia de cadastros por mes. Nao era viavel, e
-- a decisao de deixar de fora estava certa PARA AQUELE DESENHO.
--
-- O QUE MUDOU DO LADO DO APP (v5.8.0). O catalogo passou a ser SEMENTE
-- (js/mockData.js, embarcado, igual em todo aparelho) + DELTA (o que aquele
-- aparelho tem de diferente). Entao o que precisa viajar nao e a lista: e o
-- delta, que sao dezenas de linhas. O que falta para isso funcionar e o banco
-- saber responder "o que mudou desde X" sem varrer as 19 mil linhas.
--
-- O QUE ESTA MIGRATION FAZ
--
--   1. Cria `atualizado_em` nas duas tabelas, com TRIGGER.
--
--      TRIGGER, e nao carimbo do app, DE PROPOSITO. O cursor da leitura
--      incremental e comparado entre aparelhos diferentes; se cada um
--      carimbasse com o proprio relogio, uma maquina adiantada gravaria um
--      carimbo no futuro e as outras pulariam esse registro PARA SEMPRE.
--      Com o trigger, todo carimbo sai do MESMO relogio - o do servidor - e
--      o cursor de cada aparelho e sempre um valor que o proprio servidor
--      gerou. Relogio errado no aparelho deixa de ser um problema.
--
--   2. Preenche as 19 mil linhas existentes com uma data ANTIGA E FIXA
--      (1999-01-01), nao com now().
--
--      Isto e o coracao da migration. O app le com o filtro
--      `atualizado_em >= 2000-01-01` (CloudStore.CATALOGO_EPOCA). Como toda
--      linha que ninguem tocou fica em 1999, ela NUNCA e baixada - ela ja
--      esta no aparelho, embarcada na planilha. Só o que for inserido ou
--      alterado daqui para frente ganha now() (>> 2000) e desce.
--
--      Resultado: um aparelho novo, na primeira abertura, baixa exatamente
--      os cadastros feitos desde esta migration. Zero. Nao 19 mil linhas.
--
--      AS DUAS DATAS SAO UM PAR: 1999-01-01 aqui e 2000-01-01 na constante
--      CloudStore.CATALOGO_EPOCA (js/cloudStore.js). Mudar uma sem a outra
--      faz o app baixar a base inteira a cada abertura, ou nunca baixar
--      nada. Nao mexa em uma so.
--
--   3. Corrige `deleted_by_usuario_id` de INTEGER para BIGINT nas duas.
--
--      Os ids de usuario sao gerados por store.js:gerarIdUnico(), na casa de
--      1,7e15 - nao cabem em INTEGER (teto 2,1e9). Do jeito que estava, a
--      PRIMEIRA exclusao de cliente ou produto feita por um usuario com id
--      novo derrubaria o lote inteiro com 22003 (numeric field overflow), e
--      derrubaria calada: o operador veria a linha sumir da tela e voltar no
--      ciclo seguinte. Mesmo conserto ja aplicado nas outras tabelas
--      (schema.sql, secao 20).
--
-- O QUE ESTA MIGRATION **NAO** FAZ: nao insere, nao apaga e nao altera
-- nenhum dado de cliente ou produto. As 15.139 + 4.011 linhas continuam
-- exatamente como estao - conferido por md5 contra a planilha embarcada
-- antes de escrever isto (clientes bate 100%; produtos tem 1 linha a mais, a
-- PROD-MODELO de exemplo, que fica onde esta).
--
-- REVERSIVEL: ver o bloco de rollback comentado no fim.
-- =============================================================================

BEGIN;

-- -----------------------------------------------------------------------
-- 1. deleted_by_usuario_id: INTEGER -> BIGINT
-- -----------------------------------------------------------------------
ALTER TABLE clientes ALTER COLUMN deleted_by_usuario_id TYPE BIGINT;
ALTER TABLE produtos ALTER COLUMN deleted_by_usuario_id TYPE BIGINT;

-- -----------------------------------------------------------------------
-- 2. atualizado_em
--
-- TIMESTAMPTZ (e nao TIMESTAMP) porque o valor so serve para COMPARAR entre
-- aparelhos: guardar o instante absoluto elimina qualquer duvida de fuso na
-- comparacao. Mesmo tipo ja usado em controle_viagens.atualizado_em.
-- -----------------------------------------------------------------------
ALTER TABLE clientes ADD COLUMN IF NOT EXISTS atualizado_em TIMESTAMPTZ;
ALTER TABLE produtos ADD COLUMN IF NOT EXISTS atualizado_em TIMESTAMPTZ;

-- A data antiga e fixa. Ver o item 2 do cabecalho: e ela que faz o aparelho
-- novo NAO baixar as 19 mil linhas.
UPDATE clientes SET atualizado_em = TIMESTAMPTZ '1999-01-01 00:00:00-03'
 WHERE atualizado_em IS NULL;
UPDATE produtos SET atualizado_em = TIMESTAMPTZ '1999-01-01 00:00:00-03'
 WHERE atualizado_em IS NULL;

ALTER TABLE clientes ALTER COLUMN atualizado_em SET DEFAULT now();
ALTER TABLE produtos ALTER COLUMN atualizado_em SET DEFAULT now();

-- -----------------------------------------------------------------------
-- 3. TRIGGER
--
-- BEFORE INSERT OR UPDATE, e sobrescrevendo o que vier do cliente: o app
-- NAO envia esta coluna (ela fica fora da lista branca de colunas em
-- CloudStore.COLUNAS_POR_TABELA justamente por isso), mas se um dia enviar,
-- o servidor ignora. O carimbo e do servidor, ponto.
-- -----------------------------------------------------------------------
CREATE OR REPLACE FUNCTION jr_marcar_atualizado_em()
RETURNS TRIGGER AS $$
BEGIN
  NEW.atualizado_em := now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_clientes_atualizado_em ON clientes;
CREATE TRIGGER trg_clientes_atualizado_em
  BEFORE INSERT OR UPDATE ON clientes
  FOR EACH ROW EXECUTE FUNCTION jr_marcar_atualizado_em();

DROP TRIGGER IF EXISTS trg_produtos_atualizado_em ON produtos;
CREATE TRIGGER trg_produtos_atualizado_em
  BEFORE INSERT OR UPDATE ON produtos
  FOR EACH ROW EXECUTE FUNCTION jr_marcar_atualizado_em();

-- -----------------------------------------------------------------------
-- 4. Indice da leitura incremental
--
-- E o unico filtro que o app usa nessas duas tabelas. Sem indice, cada
-- ciclo de 30 segundos de cada aparelho faz um seq scan de 19 mil linhas.
-- -----------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_clientes_atualizado_em ON clientes(atualizado_em);
CREATE INDEX IF NOT EXISTS idx_produtos_atualizado_em ON produtos(atualizado_em);

COMMIT;

-- O PostgREST guarda o schema em cache. Sem isto, a coluna nova so aparece
-- para o app depois de alguns minutos - e ate la o app trata a leitura
-- filtrada como "migration nao aplicada".
NOTIFY pgrst, 'reload schema';

-- =============================================================================
-- CONFERENCIA (rode DEPOIS, e confira os tres numeros)
-- =============================================================================
-- 1) As colunas existem e o tipo do deleted_by_usuario_id mudou:
--
--    SELECT table_name, column_name, data_type
--      FROM information_schema.columns
--     WHERE table_schema='public' AND table_name IN ('clientes','produtos')
--       AND column_name IN ('atualizado_em','deleted_by_usuario_id')
--     ORDER BY table_name, column_name;
--
-- 2) NENHUMA linha antiga ficou com carimbo recente. As duas contagens
--    abaixo TEM de dar 0 - se derem diferente de 0, o app vai baixar essas
--    linhas na proxima abertura de todo aparelho:
--
--    SELECT (SELECT count(*) FROM clientes WHERE atualizado_em >= TIMESTAMPTZ '2000-01-01') AS clientes_recentes,
--           (SELECT count(*) FROM produtos WHERE atualizado_em >= TIMESTAMPTZ '2000-01-01') AS produtos_recentes;
--
-- 3) O total nao mudou (15.139 clientes e 4.011 produtos):
--
--    SELECT (SELECT count(*) FROM clientes) AS clientes, (SELECT count(*) FROM produtos) AS produtos;
--
-- =============================================================================
-- ROLLBACK (nao deveria ser necessario - nada aqui apaga dado)
-- =============================================================================
-- DROP TRIGGER IF EXISTS trg_clientes_atualizado_em ON clientes;
-- DROP TRIGGER IF EXISTS trg_produtos_atualizado_em ON produtos;
-- DROP FUNCTION IF EXISTS jr_marcar_atualizado_em();
-- DROP INDEX IF EXISTS idx_clientes_atualizado_em;
-- DROP INDEX IF EXISTS idx_produtos_atualizado_em;
-- ALTER TABLE clientes DROP COLUMN IF EXISTS atualizado_em;
-- ALTER TABLE produtos DROP COLUMN IF EXISTS atualizado_em;
-- NOTIFY pgrst, 'reload schema';
