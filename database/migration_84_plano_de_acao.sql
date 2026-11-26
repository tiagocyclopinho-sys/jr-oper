-- =============================================================================
-- MIGRATION 84 — Plano de Ação (Visão Geral → Plano de Ação)
-- (26/11/2026, sai com a v7.9.0)
-- =============================================================================
-- Pedido do Tiago: trazer para o app a planilha "Plano de Ação" da Reunião
-- de Manutenção Quinzenal (S:\...\20 - VICTOR HUGO\Reunião Manutenção
-- Quinzenal\Plano de Ação.xlsx), mas para QUALQUER ação de qualquer origem.
-- A planilha estava vazia: começa do zero. Plano: PLANO_ABA_PLANO_DE_ACAO.md.
--
-- Campos da planilha: Ação (O quê?), Descrição (Como?), Área, Responsável
-- (Quem?), Local (Onde?), Início, Final (= prazo), Comentário, Data Realizada,
-- Status, Tempo. "Tempo" e "Atrasada" são CALCULADOS na tela, não gravados.
--
-- MESMO MODELO DO CROSS PALMAS (migration 81): a tela lê da nuvem ao abrir e
-- grava direto no PostgREST. Estas tabelas NÃO entram no pull do cloudStore
-- nem no localStorage — não pesam no egress nem na cota do aparelho, e um
-- aparelho com versão velha em cache não sobrescreve nada.
--
-- pa_eventos é a linha do tempo: SÓ INCLUSÃO (sem policy de UPDATE/DELETE).
-- Fotos: bucket plano-acao-fotos; o banco guarda só o caminho.
--
-- Horário: carimbos em Brasília (lição da guarda da Escala, carimbo em UTC).
-- Idempotente.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1) AÇÕES
-- -----------------------------------------------------------------------------
CREATE SEQUENCE IF NOT EXISTS pa_acoes_numero_seq;

CREATE TABLE IF NOT EXISTS pa_acoes (
    id                     BIGINT PRIMARY KEY,
    numero                 BIGINT NOT NULL DEFAULT nextval('pa_acoes_numero_seq'),
    origem                 VARCHAR(160),
    origem_data            DATE,
    acao                   TEXT NOT NULL,
    descricao              TEXT,
    local                  VARCHAR(200),
    area                   VARCHAR(80),
    responsavel_nome       VARCHAR(120),
    responsavel_usuario_id BIGINT,
    inicio                 DATE,
    prazo_original         DATE,
    prazo                  DATE,
    qtd_adiamentos         INTEGER NOT NULL DEFAULT 0,
    data_realizada         DATE,
    status                 VARCHAR(20) NOT NULL DEFAULT 'NAO_INICIADA',
    motivo_status          TEXT,
    criado_por             VARCHAR(120),
    criado_em              TIMESTAMP DEFAULT (now() AT TIME ZONE 'America/Sao_Paulo'),
    atualizado_por         VARCHAR(120),
    atualizado_em          TIMESTAMP DEFAULT (now() AT TIME ZONE 'America/Sao_Paulo'),
    is_deleted             BOOLEAN NOT NULL DEFAULT FALSE,
    deleted_at             TIMESTAMP,
    deleted_by_nome        VARCHAR(120),
    CONSTRAINT ck_pa_acoes_status CHECK (status IN
      ('NAO_INICIADA','EM_ANDAMENTO','AGUARDANDO','EM_VALIDACAO','REALIZADA','CANCELADA'))
);
ALTER SEQUENCE pa_acoes_numero_seq OWNED BY pa_acoes.numero;
CREATE UNIQUE INDEX IF NOT EXISTS ux_pa_acoes_numero ON pa_acoes (numero);
CREATE INDEX IF NOT EXISTS ix_pa_acoes_prazo ON pa_acoes (prazo) WHERE is_deleted = FALSE;

-- -----------------------------------------------------------------------------
-- 2) ETAPAS
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS pa_etapas (
    id                     BIGINT PRIMARY KEY,
    acao_id                BIGINT NOT NULL,
    ordem                  INTEGER NOT NULL DEFAULT 0,
    descricao              TEXT NOT NULL,
    responsavel_nome       VARCHAR(120),
    responsavel_usuario_id BIGINT,
    prazo                  DATE,
    status                 VARCHAR(20) NOT NULL DEFAULT 'NAO_INICIADA',
    data_realizada         DATE,
    fotos_paths            JSONB DEFAULT '[]'::jsonb,
    criado_por             VARCHAR(120),
    criado_em              TIMESTAMP DEFAULT (now() AT TIME ZONE 'America/Sao_Paulo'),
    atualizado_por         VARCHAR(120),
    atualizado_em          TIMESTAMP DEFAULT (now() AT TIME ZONE 'America/Sao_Paulo'),
    is_deleted             BOOLEAN NOT NULL DEFAULT FALSE,
    CONSTRAINT ck_pa_etapas_status CHECK (status IN
      ('NAO_INICIADA','EM_ANDAMENTO','AGUARDANDO','EM_VALIDACAO','REALIZADA','CANCELADA'))
);
CREATE INDEX IF NOT EXISTS ix_pa_etapas_acao ON pa_etapas (acao_id) WHERE is_deleted = FALSE;

-- -----------------------------------------------------------------------------
-- 3) LINHA DO TEMPO (só inclusão)
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS pa_eventos (
    id          BIGINT PRIMARY KEY,
    acao_id     BIGINT NOT NULL,
    etapa_id    BIGINT,
    tipo        VARCHAR(20) NOT NULL,
    de          TEXT,
    para        TEXT,
    texto       TEXT,
    fotos_paths JSONB DEFAULT '[]'::jsonb,
    autor       VARCHAR(120),
    criado_em   TIMESTAMP DEFAULT (now() AT TIME ZONE 'America/Sao_Paulo'),
    CONSTRAINT ck_pa_eventos_tipo CHECK (tipo IN
      ('CRIACAO','STATUS','PRAZO','ETAPA','COMENTARIO','EDICAO','EXCLUSAO'))
);
CREATE INDEX IF NOT EXISTS ix_pa_eventos_acao ON pa_eventos (acao_id);

-- -----------------------------------------------------------------------------
-- 4) ÁREAS → RESPONSÁVEL SUGERIDO (editável na tela)
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS pa_areas (
    area                 VARCHAR(80) PRIMARY KEY,
    responsavel_sugerido VARCHAR(120),
    ativo                BOOLEAN NOT NULL DEFAULT TRUE,
    atualizado_por       VARCHAR(120),
    atualizado_em        TIMESTAMP DEFAULT (now() AT TIME ZONE 'America/Sao_Paulo')
);

-- Lista da aba BD da planilha, corrigida pelo Tiago em 26/11:
-- SAC = Adriana (não Dayanne); Supervisão CD - Frio = Gustavo (David saiu).
INSERT INTO pa_areas (area, responsavel_sugerido) VALUES
  ('SAC',                  'ADRIANA'),
  ('RASTREAMENTO',         'BRENO'),
  ('MONITORAMENTO',        'CLÁUDIO'),
  ('FATURAMENTO',          'LUIZINHO'),
  ('MANUTENÇÃO',           'LEONARDO'),
  ('COMPRAS',              'DAVID PALHARES'),
  ('SUPERVISÃO',           'VICTOR HUGO'),
  ('GERÊNCIA',             'PAULO'),
  ('GERÊNCIA CD',          'ROBINHO'),
  ('SUPERVISÃO CD - FRIO', 'GUSTAVO'),
  ('SUPERVISÃO CD - SECO', 'MARQUINHOS'),
  ('ANALISTA',             'TIAGO'),
  ('MONT. CARGAS',         'LUCAS'),
  ('TECNOLOGIA',           'RUSÍVELL')
ON CONFLICT (area) DO NOTHING;

-- -----------------------------------------------------------------------------
-- 5) RLS — mesmo padrão do Cross Palmas; eventos sem UPDATE/DELETE
-- -----------------------------------------------------------------------------
ALTER TABLE pa_acoes   ENABLE ROW LEVEL SECURITY;
ALTER TABLE pa_etapas  ENABLE ROW LEVEL SECURITY;
ALTER TABLE pa_eventos ENABLE ROW LEVEL SECURITY;
ALTER TABLE pa_areas   ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "acesso_total_anon" ON pa_acoes;
CREATE POLICY "acesso_total_anon" ON pa_acoes  FOR ALL TO anon USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS "acesso_total_anon" ON pa_etapas;
CREATE POLICY "acesso_total_anon" ON pa_etapas FOR ALL TO anon USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS "acesso_total_anon" ON pa_areas;
CREATE POLICY "acesso_total_anon" ON pa_areas  FOR ALL TO anon USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "leitura_anon"  ON pa_eventos;
CREATE POLICY "leitura_anon"  ON pa_eventos FOR SELECT TO anon USING (true);
DROP POLICY IF EXISTS "inclusao_anon" ON pa_eventos;
CREATE POLICY "inclusao_anon" ON pa_eventos FOR INSERT TO anon WITH CHECK (true);

-- O app cria a ação com POST e precisa ler o número que o banco gerou.
GRANT USAGE, SELECT ON SEQUENCE pa_acoes_numero_seq TO anon, authenticated;

-- -----------------------------------------------------------------------------
-- 6) BUCKET DE FOTOS (modelo das migrations 34/38/41)
-- -----------------------------------------------------------------------------
-- Público pelo mesmo raciocínio da 41; SELECT e INSERT liberados, UPDATE e
-- DELETE ausentes (foto de evidência não se apaga com um clique).
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('plano-acao-fotos', 'plano-acao-fotos', true, 5242880,
        array['image/jpeg','image/png','image/webp'])
ON CONFLICT (id) DO UPDATE
  SET public             = excluded.public,
      file_size_limit    = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

DROP POLICY IF EXISTS "plano_acao_fotos_select_anon" ON storage.objects;
CREATE POLICY "plano_acao_fotos_select_anon" ON storage.objects
  FOR SELECT TO anon, authenticated USING (bucket_id = 'plano-acao-fotos');
DROP POLICY IF EXISTS "plano_acao_fotos_insert_anon" ON storage.objects;
CREATE POLICY "plano_acao_fotos_insert_anon" ON storage.objects
  FOR INSERT TO anon, authenticated WITH CHECK (bucket_id = 'plano-acao-fotos');

NOTIFY pgrst, 'reload schema';

-- =============================================================================
-- CONFERÊNCIA — espere 6 linhas com ok = true:
-- select 'pa_acoes' item, to_regclass('public.pa_acoes') is not null ok
-- union all select 'pa_etapas',  to_regclass('public.pa_etapas')  is not null
-- union all select 'pa_eventos', to_regclass('public.pa_eventos') is not null
-- union all select 'pa_areas = 14', (select count(*) from pa_areas) = 14
-- union all select 'bucket', exists (select 1 from storage.buckets where id = 'plano-acao-fotos')
-- union all select '2 policies do bucket', (select count(*) from pg_policies
--   where schemaname='storage' and tablename='objects'
--     and policyname like 'plano_acao_fotos_%') = 2;
-- =============================================================================
