-- =================================================================
-- MIGRATION 25a — TABELA dispositivos  (ETAPA 2b)
--
-- Decisão 10, de 22/08/2026: esta tabela saiu da migration_25 e passou a
-- rodar sozinha, logo depois do deploy das Ondas 1+2 e ANTES da ETAPA 3.
--
-- Por quê: é ela que sustenta a tela Governança → Aparelhos, e é na ETAPA 3
-- que se precisa saber qual máquina está em qual versão. No celular não
-- existe console — esta tela é o único jeito de ler um celular. Como a
-- migration_25 (a faxina) roda por último de propósito, a tela chegaria
-- tarde demais.
--
-- É seguro rodar na frente: só CRIA coisa nova. Não encosta em
-- controle_viagens, não apaga nada, não cria índice único sobre dado que
-- ainda tem duplicata. Build antiga ignora a tabela; build nova a preenche.
--
-- Idempotente: pode rodar duas vezes sem estragar nada.
-- =================================================================

CREATE TABLE IF NOT EXISTS dispositivos (
  -- Gerado no próprio aparelho e guardado no navegador dele
  -- (localStorage 'jr_device_id'). Não é o usuário: é a máquina.
  id                  TEXT PRIMARY KEY,

  -- Nome dado por gente: "CCO 1", "Celular do Expedição".
  -- Preenchido pela tela de Aparelhos ou por jrNomearAparelho('...').
  apelido             TEXT,

  -- Sistema e navegador, detectados sozinhos: "Windows / Chrome".
  plataforma          TEXT,

  -- A versão do app que este aparelho está rodando. É a coluna que
  -- responde "quem ainda não atualizou".
  build               TEXT,

  ultimo_usuario      TEXT,
  ultimo_acesso       TIMESTAMPTZ DEFAULT now(),

  -- Quantos registros deste aparelho a guarda na escrita recusou (Onda 1,
  -- item 7). Zero é o esperado. Qualquer número aqui é o aparelho que
  -- carrega o cache contaminado dos 247 fantasmas da ETAPA 0.
  registros_recusados INTEGER DEFAULT 0,

  criado_em           TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_dispositivos_ultimo_acesso
    ON dispositivos (ultimo_acesso DESC);

-- Se a tabela já existir de uma execução anterior sem alguma coluna:
ALTER TABLE dispositivos ADD COLUMN IF NOT EXISTS apelido             TEXT;
ALTER TABLE dispositivos ADD COLUMN IF NOT EXISTS plataforma          TEXT;
ALTER TABLE dispositivos ADD COLUMN IF NOT EXISTS build               TEXT;
ALTER TABLE dispositivos ADD COLUMN IF NOT EXISTS ultimo_usuario      TEXT;
ALTER TABLE dispositivos ADD COLUMN IF NOT EXISTS ultimo_acesso       TIMESTAMPTZ DEFAULT now();
ALTER TABLE dispositivos ADD COLUMN IF NOT EXISTS registros_recusados INTEGER DEFAULT 0;
ALTER TABLE dispositivos ADD COLUMN IF NOT EXISTS criado_em           TIMESTAMPTZ DEFAULT now();

-- RLS: este projeto está aberto para a chave anon (dívida conhecida,
-- registrada no GO_LIVE.md, fora do escopo desta rodada). A tabela segue o
-- mesmo padrão das demais para não criar uma exceção que ninguém lembraria
-- de manter.
ALTER TABLE dispositivos DISABLE ROW LEVEL SECURITY;

-- =================================================================
-- CONFERÊNCIA — rode logo depois; tem que devolver 1
-- =================================================================
-- SELECT count(*) AS tabela_dispositivos
--   FROM information_schema.tables
--  WHERE table_name = 'dispositivos';
--
-- E, depois de abrir o app em um PC, esta tem que devolver pelo menos 1:
-- SELECT id, apelido, plataforma, build, ultimo_acesso, registros_recusados
--   FROM dispositivos
--  ORDER BY ultimo_acesso DESC;
