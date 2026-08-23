-- =============================================================================
-- MIGRACAO 25 - CADASTROS MESTRES QUE NUNCA CHEGAVAM AO BANCO (23/08/2026)
--
-- SINTOMA RELATADO: ao cadastrar o motivo de devolucao "NOTA DENEGADA" pela
-- tela de Cadastros Mestres, o sistema exibiu um alerta com a palavra
-- "undefined". A pergunta que veio junto - "estao atualizando tudo, tanto no
-- sistema como no banco de dados?" - se mostrou a mais importante das duas.
--
-- O "undefined" era so um contrato de retorno errado no JavaScript (o motivo
-- ate era gravado; a tela e que nao se atualizava). Corrigido em store.js /
-- app.js, sem SQL.
--
-- O problema de fundo e este: das 8 abas de Cadastros Mestres, apenas 4
-- chegavam ao Supabase.
--
--   Motoristas .......... OK
--   Ajudantes ........... OK
--   Colaboradores CD .... OK
--   Veiculos ............ OK
--   Rotas ............... nao existia tabela; vivia so no localStorage
--   Motivos Devolucao ... nao existia tabela; vivia so no localStorage
--   Produtos ............ tabela existia, mas nunca era enviada
--   Clientes ............ tabela existia, mas nunca era enviada
--
-- Consequencia pratica: um motivo cadastrado no PC do analista nao existia
-- para mais ninguem, sumia ao limpar o cache do navegador, e nunca aparecia
-- no Power BI. Exatamente o oposto do que a tela de cadastro se propoe a
-- fazer - permitir que qualquer pessoa registre pelo sistema, sem abrir
-- chamado para rodar SQL na mao.
--
-- Esta migracao prepara o banco para receber as quatro que faltavam. O lado
-- do app (cloudStore.js) ja foi ajustado para envia-las.
--
-- Rode o arquivo inteiro no SQL Editor do Supabase. E idempotente.
-- =============================================================================

BEGIN;

-- -----------------------------------------------------------------------
-- 25.1 ROTAS E MOTIVOS DE DEVOLUCAO - TABELAS NOVAS
--
-- No app as duas sao listas de texto simples (array de string), e varias
-- telas as consomem assim - o <select> de "Motivo Reclamado" da devolucao e
-- o de Causa Raiz da investigacao fazem .map() direto sobre o texto. Manter
-- esse formato foi decisao consciente: transforma-las em objeto exigiria
-- mexer em ~10 telas sem nenhum ganho para quem usa.
--
-- Por isso a chave primaria e o proprio NOME, e nao um id sintetico: e o
-- nome que a devolucao grava na coluna motivo_reclamado, e e por ele que o
-- Power BI vai cruzar. Um id novo aqui so criaria uma juncao a mais sem
-- representar nada de negocio.
--
-- A coluna `ativo` e o que faz a EXCLUSAO viajar entre aparelhos. O envio
-- do app e um upsert - ele nunca apaga linha - entao excluir um motivo
-- apenas na lista local seria desfeito na proxima leitura, que o traria de
-- volta do banco (o classico "excluí e voltou sozinho"). Excluir pela tela
-- grava ativo=false, e todo aparelho que ler essa linha tira o item da sua
-- lista. Ninguem perde historico: uma devolucao antiga continua apontando
-- para o texto do motivo mesmo depois dele sair de circulacao, e o Power BI
-- continua enxergando os dois estados.
-- -----------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS rotas (
    nome        VARCHAR(120) PRIMARY KEY,
    ativo       BOOLEAN DEFAULT TRUE,
    criado_em   TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS motivos_devolucao (
    nome        VARCHAR(160) PRIMARY KEY,
    ativo       BOOLEAN DEFAULT TRUE,
    criado_em   TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- -----------------------------------------------------------------------
-- 25.2 CLIENTES E PRODUTOS - COLUNAS DA EXCLUSAO LOGICA
--
-- A tela de Cadastros exclui cliente/produto pela Lixeira, que e exclusao
-- logica: o app marca is_deleted/deleted_at/deleted_by_* no registro e o
-- envia. Nenhuma dessas colunas existe nestas duas tabelas - e o upsert do
-- PostgREST recusa o LOTE INTEIRO quando encontra uma coluna desconhecida
-- (PGRST204). Sem isto, a primeira exclusao de cliente feita por alguem
-- travaria a sincronizacao das 15.139 linhas de clientes, silenciosamente.
--
-- Mesmo padrao ja aplicado em colaboradores_cd na criacao do schema.
-- -----------------------------------------------------------------------
ALTER TABLE clientes ADD COLUMN IF NOT EXISTS is_deleted            BOOLEAN DEFAULT FALSE;
ALTER TABLE clientes ADD COLUMN IF NOT EXISTS deleted_at            TIMESTAMP NULL;
ALTER TABLE clientes ADD COLUMN IF NOT EXISTS deleted_by_usuario_id BIGINT NULL;
ALTER TABLE clientes ADD COLUMN IF NOT EXISTS deleted_by_nome       VARCHAR(120) NULL;

ALTER TABLE produtos ADD COLUMN IF NOT EXISTS is_deleted            BOOLEAN DEFAULT FALSE;
ALTER TABLE produtos ADD COLUMN IF NOT EXISTS deleted_at            TIMESTAMP NULL;
ALTER TABLE produtos ADD COLUMN IF NOT EXISTS deleted_by_usuario_id BIGINT NULL;
ALTER TABLE produtos ADD COLUMN IF NOT EXISTS deleted_by_nome       VARCHAR(120) NULL;

-- -----------------------------------------------------------------------
-- 25.3 CLIENTES.CNPJ - O MESMO BURACO DA MIGRACAO 24
--
-- clientes.cnpj e VARCHAR(20) UNIQUE NOT NULL. A planilha Dados SAC nao tem
-- coluna de CNPJ: os 15.139 clientes embarcados em mockData.js nao trazem o
-- campo. Sem esta correcao, a primeira tentativa de enviar o catalogo
-- morreria em 23502 (NOT NULL) e, se preenchessemos com branco para
-- contornar, morreria em 23505 - varias strings vazias colidem numa coluna
-- UNIQUE, enquanto varios NULL convivem. E exatamente o que aconteceu com
-- motoristas.cnh em 22/08/2026 (migracao 24): de 39 motoristas, so 2 subiam.
--
-- Solucao identica: indice unico PARCIAL, que ignora branco e nulo. A regra
-- de negocio continua valendo (nao existem dois clientes com o MESMO CNPJ
-- preenchido), mas quem ainda nao teve o CNPJ cadastrado deixa de bloquear
-- a tabela inteira.
-- -----------------------------------------------------------------------
ALTER TABLE clientes DROP CONSTRAINT IF EXISTS clientes_cnpj_key;
ALTER TABLE clientes ALTER COLUMN cnpj DROP NOT NULL;
DROP INDEX IF EXISTS uq_clientes_cnpj;
CREATE UNIQUE INDEX uq_clientes_cnpj
  ON clientes (cnpj) WHERE cnpj IS NOT NULL AND cnpj <> '';

-- codigo_cliente sofre do mesmo risco (UNIQUE NOT NULL, alimentado por
-- planilha e por formulario). Alinhado ao mesmo padrao antes que trave.
ALTER TABLE clientes DROP CONSTRAINT IF EXISTS clientes_codigo_cliente_key;
ALTER TABLE clientes ALTER COLUMN codigo_cliente DROP NOT NULL;
DROP INDEX IF EXISTS uq_clientes_codigo;
CREATE UNIQUE INDEX uq_clientes_codigo
  ON clientes (codigo_cliente) WHERE codigo_cliente IS NOT NULL AND codigo_cliente <> '';

-- razao_social/descricao NOT NULL: o app ja barra o cadastro sem nome, mas
-- um registro antigo importado sem descricao derrubaria o lote inteiro.
ALTER TABLE clientes ALTER COLUMN razao_social DROP NOT NULL;
ALTER TABLE produtos ALTER COLUMN descricao    DROP NOT NULL;
ALTER TABLE produtos ALTER COLUMN codigo_produto DROP NOT NULL;

-- -----------------------------------------------------------------------
-- 25.4 SETORES - CODIGO OBRIGATORIO QUE O APP NAO PREENCHE
--
-- setores.codigo e UNIQUE NOT NULL, mas a colecao local de setores nao tem
-- esse campo. Mesmo padrao das anteriores, para nao repetir o travamento.
-- -----------------------------------------------------------------------
ALTER TABLE setores DROP CONSTRAINT IF EXISTS setores_codigo_key;
ALTER TABLE setores ALTER COLUMN codigo DROP NOT NULL;
DROP INDEX IF EXISTS uq_setores_codigo;
CREATE UNIQUE INDEX uq_setores_codigo
  ON setores (codigo) WHERE codigo IS NOT NULL AND codigo <> '';

-- -----------------------------------------------------------------------
-- 25.5 PERMISSOES (RLS)
--
-- O app acessa o Supabase com a anon key. Sem politica, a tabela nova
-- responde 200 com zero linha na leitura e recusa toda escrita - falha que
-- se parece com "a tabela esta vazia", nao com "sem permissao".
-- Mesmo padrao das demais tabelas do schema.
-- -----------------------------------------------------------------------
ALTER TABLE rotas             ENABLE ROW LEVEL SECURITY;
ALTER TABLE motivos_devolucao ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "acesso_total_anon" ON rotas;
CREATE POLICY "acesso_total_anon" ON rotas FOR ALL TO anon USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "acesso_total_anon" ON motivos_devolucao;
CREATE POLICY "acesso_total_anon" ON motivos_devolucao FOR ALL TO anon USING (true) WITH CHECK (true);

COMMIT;

-- O PostgREST guarda o schema em cache: sem este aviso, as tabelas e
-- colunas novas so seriam reconhecidas no proximo restart do projeto, e o
-- app continuaria recebendo PGRST204 por mais alguns minutos.
NOTIFY pgrst, 'reload schema';

-- =============================================================================
-- CONFERENCIA APOS RODAR
--
-- 1) As tabelas novas existem e estao vazias (vao encher sozinhas no
--    primeiro sync de cada aparelho, em ate 30s):
--
--      SELECT count(*) FROM rotas;
--      SELECT count(*) FROM motivos_devolucao;
--
-- 2) Abra o app, va em Cadastros Mestres > Motivos Devolucao e confira que
--    "NOTA DENEGADA" esta na lista. Aguarde meio minuto e rode:
--
--      SELECT nome, ativo FROM motivos_devolucao ORDER BY nome;
--
--    Os ~60 motivos da base devem aparecer, todos com ativo = true.
--
-- 3) O catalogo pesado sobe em lotes de 500 e leva alguns minutos na
--    primeira vez. Depois de ~5 min:
--
--      SELECT count(*) FROM clientes;   -- esperado: 15.139 (+ cadastros novos)
--      SELECT count(*) FROM produtos;   -- esperado:  4.010 (+ cadastros novos)
--
--    Se os numeros estiverem menores e nao subirem mais, rode
--    jrDiagnosticoSync() no console do navegador: ele lista as tabelas com
--    envio pendente e o ultimo erro recebido do banco.
--
-- 4) Teste o caminho completo, que e o objetivo de tudo isto: cadastre um
--    motivo em UM aparelho e confirme que ele aparece no <select> de
--    "Motivo Reclamado" de OUTRO aparelho, sem ninguem rodar SQL.
-- =============================================================================
