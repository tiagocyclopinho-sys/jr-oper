-- =============================================================================
-- MIGRATION 46 — usuarios: carimbo atualizado_em + guarda contra regressao
--                (15/09/2026)
-- =============================================================================
-- Aditiva e idempotente. TEM DE RODAR ANTES DO DEPLOY da build que a leva:
-- a lista branca COLUNAS_POR_TABELA.usuarios (cloudStore.js) passa a declarar
-- atualizado_em, e coluna declarada que nao existe derruba o lote inteiro
-- com PGRST204 — em silencio, para sempre (ver o comentario da propria lista
-- branca, caso de 31/08/2026 com cinco pessoas sem cadastro na nuvem).
--
-- O DEFEITO
--
-- 15/09/2026. A senha da Adriana foi redefinida em "Logins e Senhas"
-- (handleRedefinirSenha) e o login dela continuou dando "Senha incorreta".
-- `usuarios` era a unica tabela editavel pelo app SEM atualizado_em: a
-- mesclagem do pull (_mesclarPorRegistro) cai na regra antiga, so por hash.
-- Basta a copia local do cadastro em OUTRO aparelho estar "suja" (um
-- switchRole, um toggle de ativo, qualquer campo divergente do que a nuvem
-- confirmou) para aquele aparelho RECUSAR o hash novo no pull e, no push
-- seguinte, EMPURRAR O HASH ANTIGO por cima da redefinicao. O admin ve
-- "redefinida com sucesso"; a pessoa continua trancada; ninguem ve por que.
--
-- E a mesma classe de defeito das migrations 43 e 45 (retencoes_frota), na
-- tabela que decide quem entra no sistema.
--
-- O QUE ESTA MIGRATION FAZ
--
--   1. Cria usuarios.atualizado_em (TIMESTAMP, nulo por padrao). Sem
--      backfill de proposito: linha com carimbo nulo continua aceitando
--      qualquer gravacao, entao aparelho em build antiga (que nao carimba)
--      segue conseguindo editar ate migrar. O primeiro carimbo de cada linha
--      vem da primeira edicao numa build que carimba.
--
--   2. Anexa jr_recusar_carimbo_regressivo() (criada na migration 45) como
--      BEFORE UPDATE. A partir do momento em que a linha tem carimbo, um
--      UPDATE com carimbo nulo ou mais velho e IGNORADO (RETURN NULL: sem
--      erro, o aparelho recebe 200, confirma o hash, deixa de ver o registro
--      como sujo e aceita a versao da nuvem no pull seguinte). E exatamente o
--      cenario da Adriana: o aparelho com cache velho tenta devolver o hash
--      antigo com atualizado_em nulo — o banco ignora, e ele se corrige.
--
-- CONDICAO DA MIGRATION 45 ("so anexar depois de conferir que TODO caminho
-- de edicao carimba"), conferida nesta build:
--   app.js    handleRedefinirSenha, toggleAtivoUsuario, handleSalvarEdicaoUsuario
--   store.js  switchRole, login (re-hash de senha em texto puro), addUsuario
-- Todos passam por Store#carimbarEdicao('usuarios', u); 'usuarios' entrou em
-- Store.COLECOES_COM_ATUALIZADO_EM. Build anterior a esta nao envia a coluna
-- (nao esta na lista branca dela), entao o ON CONFLICT do PostgREST mantem o
-- carimbo que ja esta na linha e a guarda deixa passar — compatibilidade
-- durante a transicao, sem protecao para o que a build antiga gravar.
--
-- O QUE ELA NAO FAZ
--   - Nao backfilla, nao mexe em senha_hash, nao mexe em INSERT nem DELETE.
--   - Nao muda RLS nem policies (acesso_total_anon continua).
-- =============================================================================

ALTER TABLE usuarios ADD COLUMN IF NOT EXISTS atualizado_em TIMESTAMP;

COMMENT ON COLUMN usuarios.atualizado_em IS
  'Carimbo do app (Store#carimbarEdicao) em toda edicao de verdade: senha, ativo, nome/role/cargo/departamento, troca de papel. Desempate do pull e guarda BEFORE UPDATE (migration 46).';

-- A funcao ja existe desde a migration 45. Recriar aqui e so para instalacao
-- nova que rode as migrations fora de ordem; o corpo e identico.
CREATE OR REPLACE FUNCTION jr_recusar_carimbo_regressivo()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF OLD.atualizado_em IS NOT NULL
     AND (NEW.atualizado_em IS NULL OR NEW.atualizado_em < OLD.atualizado_em) THEN
    RETURN NULL;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_usuarios_guarda_carimbo ON usuarios;
CREATE TRIGGER trg_usuarios_guarda_carimbo
  BEFORE UPDATE ON usuarios
  FOR EACH ROW
  EXECUTE FUNCTION jr_recusar_carimbo_regressivo();

-- Conferencia
-- SELECT column_name, data_type FROM information_schema.columns
--  WHERE table_name = 'usuarios' AND column_name = 'atualizado_em';
-- SELECT tgname, tgenabled FROM pg_trigger
--  WHERE tgrelid = 'usuarios'::regclass AND NOT tgisinternal;
--
-- Prova de bancada (nao roda sozinha; copiar e rodar a mao num usuario de teste):
--   UPDATE usuarios SET atualizado_em = now() WHERE email = 'teste@exemplo';
--   UPDATE usuarios SET cargo = 'X', atualizado_em = NULL WHERE email = 'teste@exemplo';
--   -- o segundo UPDATE responde "UPDATE 0" e a linha fica como estava.
