-- =============================================================================
-- MIGRATION 44 — Reorganização do CD: três tabelas próprias (11/09/2026)
-- =============================================================================
-- Plano: PLANO_DE_ACAO_REORGANIZACAO_CD.md, Bloco A. Sai com a v6.7.0.
--
-- O QUE MUDA
--
-- O Resumo Diário do CD guardava três coisas como arrays JSONB dentro do
-- envelope data+turno (resumo_diario_cd.ocorrencias, .ocorrencias_colaboradores
-- e .cortes). Registro aninhado não tem data própria, não tem identidade
-- endereçável e não sincroniza sozinho: editar a data não movia o registro de
-- dia, e todo botão da tela carregava (data, turno, tipo, índice). Cada coisa
-- passa a ter tabela própria, no mesmo padrão das demais (PK BIGINT gerado
-- pelo app, RLS ligada, policy acesso_total_anon, soft delete, atualizado_em
-- carimbado pelo app — ver Store#carimbarEdicao).
--
-- ESTA MIGRATION É ADITIVA. As três colunas JSONB do resumo_diario_cd
-- PERMANECEM INTACTAS: são a rede de segurança até a migração de dados (feita
-- pelo próprio app no boot, Store#migrarFilhosDoResumoDiario, idempotente por
-- id) ser conferida em produção. Apagá-las é decisão de outro plano.
--
-- ORDEM: rodar ANTES de publicar a 6.7.0. O app novo grava nestas tabelas no
-- primeiro boot; sem elas o PostgREST responde 404 e nada sincroniza. Rodar
-- com o app antigo no ar não faz mal — ele nem sabe que existem.
--
-- Idempotente: pode rodar duas vezes.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1) ocorrencias_cd — Ocorrência do CD (Item 3 do Resumo Diário)
--    Sem funcionário, sem status, de propósito (decisões 1 e 2 do plano).
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS ocorrencias_cd (
    id              BIGINT PRIMARY KEY,
    data            DATE NOT NULL,
    turno           VARCHAR(40) NOT NULL,
    ocorrencia      TEXT,
    causa           TEXT,
    acao            TEXT,
    gestor          VARCHAR(120),
    criado_por      VARCHAR(120),
    criado_em       TIMESTAMP,
    atualizado_em   TIMESTAMP,
    is_deleted      BOOLEAN DEFAULT FALSE,
    deleted_at      TIMESTAMP,
    deleted_by_nome VARCHAR(120)
);
ALTER TABLE ocorrencias_cd ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "acesso_total_anon" ON ocorrencias_cd;
CREATE POLICY "acesso_total_anon" ON ocorrencias_cd FOR ALL TO anon USING (true) WITH CHECK (true);
CREATE INDEX IF NOT EXISTS idx_ocorrencias_cd_data ON ocorrencias_cd (data, turno);

-- ---------------------------------------------------------------------------
-- 2) ocorrencias_colaborador — Ocorrência Colaborador (a antiga subaba
--    "Ocorrências CD"). Aqui há pessoa, e ela é CLT: mantém status e os
--    campos que a emissão disciplinar grava de volta.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS ocorrencias_colaborador (
    id                    BIGINT PRIMARY KEY,
    data                  DATE NOT NULL,
    turno                 VARCHAR(40) NOT NULL,
    funcionario           VARCHAR(120),
    requisito             VARCHAR(120),
    carga                 VARCHAR(40),
    peso                  NUMERIC(12,2),
    detalhamento          TEXT,
    acao                  TEXT,
    status                VARCHAR(20) DEFAULT 'PENDENTE',
    medida_disciplinar    VARCHAR(30),
    alinea_clt            TEXT,
    dias_suspensao        INT,
    disciplinar_gerada_em TIMESTAMP,
    gestor                VARCHAR(120),
    criado_por            VARCHAR(120),
    criado_em             TIMESTAMP,
    atualizado_em         TIMESTAMP,
    is_deleted            BOOLEAN DEFAULT FALSE,
    deleted_at            TIMESTAMP,
    deleted_by_nome       VARCHAR(120)
);
ALTER TABLE ocorrencias_colaborador ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "acesso_total_anon" ON ocorrencias_colaborador;
CREATE POLICY "acesso_total_anon" ON ocorrencias_colaborador FOR ALL TO anon USING (true) WITH CHECK (true);
CREATE INDEX IF NOT EXISTS idx_ocorrencias_colaborador_data ON ocorrencias_colaborador (data, turno);
CREATE INDEX IF NOT EXISTS idx_ocorrencias_colaborador_func ON ocorrencias_colaborador (funcionario);

-- ---------------------------------------------------------------------------
-- 3) cortes_cd — Corte (Item 4 do Resumo Diário)
--    codigo_item, e não cod_item: é o nome que os 14 registros já gravados
--    no JSONB carregam, e a migração de dados copia campo a campo.
--    quantidade é VARCHAR de propósito: o app guarda número puro, mas
--    registros antigos trazem "3 PACKS" — ver _qtdCorteNumero em app.js.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS cortes_cd (
    id              BIGINT PRIMARY KEY,
    data            DATE NOT NULL,
    turno           VARCHAR(40) NOT NULL,
    codigo_item     VARCHAR(40),
    descricao       VARCHAR(200),
    quantidade      VARCHAR(40),
    valor           NUMERIC(12,2) DEFAULT 0,
    gestor          VARCHAR(120),
    criado_por      VARCHAR(120),
    criado_em       TIMESTAMP,
    atualizado_em   TIMESTAMP,
    is_deleted      BOOLEAN DEFAULT FALSE,
    deleted_at      TIMESTAMP,
    deleted_by_nome VARCHAR(120)
);
ALTER TABLE cortes_cd ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "acesso_total_anon" ON cortes_cd;
CREATE POLICY "acesso_total_anon" ON cortes_cd FOR ALL TO anon USING (true) WITH CHECK (true);
CREATE INDEX IF NOT EXISTS idx_cortes_cd_data ON cortes_cd (data, turno);

-- ---------------------------------------------------------------------------
-- CONFERÊNCIA depois de publicar a 6.7.0 e de um aparelho ter aberto o app:
-- os totais das tabelas novas têm de bater com os filhos que o JSONB guarda.
-- Em 11/09/2026 o JSONB tinha 17 ocorrências, 2 colaborador e 14 cortes.
-- ---------------------------------------------------------------------------
-- SELECT
--   (SELECT count(*) FROM ocorrencias_cd           WHERE NOT is_deleted) AS oc_cd,
--   (SELECT sum(jsonb_array_length(coalesce(ocorrencias,'[]'))) FROM resumo_diario_cd WHERE NOT coalesce(is_deleted,false)) AS oc_jsonb,
--   (SELECT count(*) FROM ocorrencias_colaborador  WHERE NOT is_deleted) AS colab,
--   (SELECT sum(jsonb_array_length(coalesce(ocorrencias_colaboradores,'[]'))) FROM resumo_diario_cd WHERE NOT coalesce(is_deleted,false)) AS colab_jsonb,
--   (SELECT count(*) FROM cortes_cd                WHERE NOT is_deleted) AS cortes,
--   (SELECT sum(jsonb_array_length(coalesce(cortes,'[]'))) FROM resumo_diario_cd WHERE NOT coalesce(is_deleted,false)) AS cortes_jsonb;
