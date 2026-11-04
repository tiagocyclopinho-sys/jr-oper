-- =============================================================================
-- MIGRATION 64 — Gestão de folgas dos prestadores (04/11/2026)
-- =============================================================================
-- Sai com a v7.0.0 (subaba Escala → Folgas). Substitui a aba "Gestão de Folgas"
-- da planilha "Gestão de Folga.xlsx". Decisões do Tiago:
--   * atestado de prestador é folga com justificativa: categoria ATESTADO,
--     tratamento ABONADO (não gera desconto). O app só registra o tratamento;
--   * sem trava de aprovação: aprovado_por é informativo;
--   * da planilha entram só as folgas que impactam a partir de 26/10/2026, e
--     ali só havia uma: DIEGO MARABA (DIEGO MORAES DA SILVA), 21 a 27/12.
--
-- Mesmo padrão da escala: fora da sincronização automática (a tela lê da nuvem
-- ao abrir e grava direto), RLS com acesso_total_anon, soft delete, carimbo
-- guardado por jr_recusar_carimbo_regressivo() (migration 45).
--
-- Idempotente.
-- =============================================================================

CREATE TABLE IF NOT EXISTS escala_folgas (
    id                    BIGINT PRIMARY KEY,
    colaborador_tipo      VARCHAR(12),
    colaborador_nome      VARCHAR(160) NOT NULL,
    data_solicitacao      DATE,
    categoria             VARCHAR(40) NOT NULL DEFAULT 'FOLGA PESSOAL',
    motivo                TEXT,
    data_inicio           DATE NOT NULL,
    data_fim              DATE NOT NULL,
    periodo               VARCHAR(12) NOT NULL DEFAULT 'INTEGRAL',
    parecer               VARCHAR(12) NOT NULL DEFAULT 'PENDENTE',
    aprovado_por          VARCHAR(120),
    substituto            VARCHAR(160),
    tratamento            VARCHAR(12) NOT NULL DEFAULT 'PENDENTE',
    criado_por            VARCHAR(120),
    criado_em             TIMESTAMP,
    atualizado_por        VARCHAR(120),
    atualizado_em         TIMESTAMP,
    is_deleted            BOOLEAN DEFAULT FALSE,
    deleted_at            TIMESTAMP,
    deleted_by_nome       VARCHAR(120),
    CONSTRAINT ck_escala_folgas_datas CHECK (data_fim >= data_inicio),
    CONSTRAINT ck_escala_folgas_periodo CHECK (periodo IN ('INTEGRAL', 'MATUTINO', 'VESPERTINO')),
    CONSTRAINT ck_escala_folgas_parecer CHECK (parecer IN ('PENDENTE', 'ACEITO', 'NEGADO', 'CANCELADO')),
    CONSTRAINT ck_escala_folgas_tratamento CHECK (tratamento IN ('PENDENTE', 'ABONADO', 'DESCONTADO'))
);
ALTER TABLE escala_folgas ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "acesso_total_anon" ON escala_folgas;
CREATE POLICY "acesso_total_anon" ON escala_folgas FOR ALL TO anon USING (true) WITH CHECK (true);
CREATE INDEX IF NOT EXISTS idx_escala_folgas_datas ON escala_folgas (data_inicio, data_fim) WHERE is_deleted IS NOT TRUE;
DROP TRIGGER IF EXISTS trg_escala_folgas_guarda_carimbo ON escala_folgas;
CREATE TRIGGER trg_escala_folgas_guarda_carimbo
  BEFORE UPDATE ON escala_folgas
  FOR EACH ROW EXECUTE FUNCTION jr_recusar_carimbo_regressivo();

INSERT INTO escala_folgas (id, colaborador_tipo, colaborador_nome, data_solicitacao, categoria, motivo,
  data_inicio, data_fim, periodo, parecer, tratamento, criado_por, criado_em, atualizado_por, atualizado_em)
VALUES (1, 'MOTORISTA', 'DIEGO MORAES DA SILVA', '2026-10-26', 'FOLGA PESSOAL', 'FOLGA PESSOAL',
  '2026-12-21', '2026-12-27', 'INTEGRAL', 'PENDENTE', 'PENDENTE', 'PLANILHA GESTAO DE FOLGA',
  now() AT TIME ZONE 'America/Sao_Paulo', 'PLANILHA GESTAO DE FOLGA', now() AT TIME ZONE 'America/Sao_Paulo')
ON CONFLICT (id) DO NOTHING;
