-- =============================================================================
-- MIGRATION 48 — Controle de Infrações de trânsito (23/09/2026)
-- =============================================================================
-- Sai com a v6.8.0. Duas tabelas novas, no mesmo padrão das demais (PK BIGINT
-- gerado pelo app, RLS ligada, policy acesso_total_anon, soft delete,
-- atualizado_em carimbado pelo app — ver Store#carimbarEdicao).
--
--   infracoes_relatorios — o cabeçalho de cada lote lançado (INF-2026-0001).
--   infracoes            — UMA LINHA POR MULTA. É o que o Dossiê, a impressão
--                          geral de recibos e o Power BI leem.
--
-- LOG, EDIÇÃO E EXCLUSÃO NÃO TÊM TABELA PRÓPRIA, de propósito: criação,
-- edição, troca de status, emissão de recibo e exclusão vão para audit_logs
-- (modulo = nome da tabela), a cópia inteira de cada versão vai para
-- registro_versoes, e a exclusão é lógica (is_deleted), o que já faz o
-- registro aparecer na Governança & Lixeira. Um log paralelo não apareceria
-- em nenhuma dessas telas.
--
-- infracoes NÃO guarda o número do relatório, só relatorio_id: o número é
-- sequência gerada pelo app e o cloudStore pode renumerá-lo numa colisão
-- (SEQUENCIAS_RENUMERAVEIS). Uma cópia do número em cada multa ficaria
-- velha nessa hora. Para o Power BI, junte por relatorio_id.
--
-- numero_infracao é ÚNICO SÓ ENTRE AS NÃO EXCLUÍDAS (índice parcial, lição
-- da migration 24): lançou errado e excluiu, pode lançar de novo. A colisão
-- entre dois aparelhos offline cai na aba "⚠️ Conflitos"
-- (CAMPOS_UNICOS_POR_TABELA no cloudStore.js) — o número é do mundo real
-- (o auto de infração), então o app não renumera.
--
-- ORDEM: rodar ANTES de publicar a 6.8.0. Rodar com o app antigo no ar não
-- faz mal — ele nem sabe que as tabelas existem.
--
-- Idempotente: pode rodar duas vezes.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1) infracoes_relatorios — cabeçalho do lote
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS infracoes_relatorios (
    id                    BIGINT PRIMARY KEY,
    numero_relatorio      VARCHAR(20) NOT NULL,
    data_lancamento       DATE NOT NULL,
    responsavel           VARCHAR(120),
    observacao            TEXT,
    criado_por            VARCHAR(120),
    criado_em             TIMESTAMP,
    atualizado_por        VARCHAR(120),
    atualizado_em         TIMESTAMP,
    is_deleted            BOOLEAN DEFAULT FALSE,
    deleted_at            TIMESTAMP,
    deleted_by_usuario_id BIGINT,
    deleted_by_nome       VARCHAR(120)
);
ALTER TABLE infracoes_relatorios ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "acesso_total_anon" ON infracoes_relatorios;
CREATE POLICY "acesso_total_anon" ON infracoes_relatorios FOR ALL TO anon USING (true) WITH CHECK (true);
CREATE UNIQUE INDEX IF NOT EXISTS uq_infracoes_relatorios_numero ON infracoes_relatorios (numero_relatorio);
CREATE INDEX IF NOT EXISTS idx_infracoes_relatorios_data ON infracoes_relatorios (data_lancamento);

-- ---------------------------------------------------------------------------
-- 2) infracoes — uma linha por multa
--    prestador_tipo = MOTORISTA | AJUDANTE no momento do lançamento (ajudante
--    às vezes dirige; a busca oferece todos os prestadores).
--    status = PENDENTE | RECIBO_ASSINADO | DESCONTADO, trocado à mão.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS infracoes (
    id                    BIGINT PRIMARY KEY,
    relatorio_id          BIGINT,
    data_infracao         DATE NOT NULL,
    numero_infracao       VARCHAR(30) NOT NULL,
    valor                 NUMERIC(12,2) NOT NULL DEFAULT 0,
    prestador_nome        VARCHAR(120) NOT NULL,
    prestador_tipo        VARCHAR(20),
    veiculo_placa         VARCHAR(10),
    status                VARCHAR(20) NOT NULL DEFAULT 'PENDENTE',
    status_alterado_por   VARCHAR(120),
    status_alterado_em    TIMESTAMP,
    recibo_impresso_em    TIMESTAMP,
    recibo_impresso_qtd   INT DEFAULT 0,
    criado_por            VARCHAR(120),
    criado_em             TIMESTAMP,
    atualizado_por        VARCHAR(120),
    atualizado_em         TIMESTAMP,
    is_deleted            BOOLEAN DEFAULT FALSE,
    deleted_at            TIMESTAMP,
    deleted_by_usuario_id BIGINT,
    deleted_by_nome       VARCHAR(120),
    CONSTRAINT ck_infracoes_status CHECK (status IN ('PENDENTE', 'RECIBO_ASSINADO', 'DESCONTADO'))
);
ALTER TABLE infracoes ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "acesso_total_anon" ON infracoes;
CREATE POLICY "acesso_total_anon" ON infracoes FOR ALL TO anon USING (true) WITH CHECK (true);
CREATE UNIQUE INDEX IF NOT EXISTS uq_infracoes_numero_ativo
  ON infracoes (numero_infracao) WHERE is_deleted IS NOT TRUE;
CREATE INDEX IF NOT EXISTS idx_infracoes_relatorio ON infracoes (relatorio_id);
CREATE INDEX IF NOT EXISTS idx_infracoes_prestador ON infracoes (prestador_nome);
CREATE INDEX IF NOT EXISTS idx_infracoes_data ON infracoes (data_infracao);
CREATE INDEX IF NOT EXISTS idx_infracoes_status ON infracoes (status) WHERE is_deleted IS NOT TRUE;

-- ---------------------------------------------------------------------------
-- CONFERÊNCIA depois de publicar a 6.8.0 e lançar o primeiro relatório:
-- ---------------------------------------------------------------------------
-- SELECT r.numero_relatorio, i.data_infracao, i.numero_infracao, i.valor,
--        i.prestador_nome, i.veiculo_placa, i.status
--   FROM infracoes i LEFT JOIN infracoes_relatorios r ON r.id = i.relatorio_id
--  WHERE i.is_deleted IS NOT TRUE
--  ORDER BY i.prestador_nome, i.data_infracao;
