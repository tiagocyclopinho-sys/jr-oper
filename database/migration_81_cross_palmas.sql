-- =============================================================================
-- MIGRATION 81 — Cross Palmas: recebimento, embarque no transbordo e confronto
-- (18/11/2026, sai com a v7.6.0)
-- =============================================================================
-- Pedido do Tiago: as devoluções das rotas que passam pelo cross-docking de
-- Palmas ficam acumuladas lá e só voltam a Araguaína quando há transbordo com
-- veículo NOSSO (terceiro só deixa carga em Palmas e segue, nunca traz). A
-- viagem da rota fecha no cross, mas o produto só fecha quando o CD confere,
-- e no meio disso ninguém sabia o que estava parado em Palmas.
--
-- A partir da semana de 23/11 há uma pessoa de Palmas usando o app (perfil
-- novo CROSS, que vê todas as telas como os demais). Ela marca, ITEM A ITEM:
--   RECEBIDO_CROSS — o que chegou da rota no cross (quantidade por item);
--   EMBARQUE       — o que subiu no transbordo (quantidade, placa, viagem),
--                    agrupado por `manifesto`.
-- O CD continua conferindo no Retorno Físico; o confronto é
--   registrado (SAC) × recebido no cross × embarcado × conferido no CD.
--
-- POR QUE UMA TABELA DE MOVIMENTOS, E NÃO COLUNAS EM itens_devolucao: o envio
-- do app manda a linha inteira do item; um aparelho com versão antiga em cache
-- reenviando o item poderia apagar o que Palmas marcou (a mesma classe da
-- 6.6.3, retenções sobrescritas). Aqui só a tela do Cross grava, direto na
-- nuvem (como a Escala), e correção é exclusão lógica + lançamento novo.
--
-- Reentregas de Palmas NÃO entram aqui: usam o fluxo que já existe
-- (recebimento → despacho), com o local de recebimento "CROSS PALMAS".
--
-- Idempotente.
-- =============================================================================

CREATE TABLE IF NOT EXISTS cross_movimentos (
    id                BIGINT PRIMARY KEY,
    tipo              VARCHAR(20) NOT NULL,
    local_cross       VARCHAR(30) NOT NULL DEFAULT 'PALMAS',
    devolucao_id      BIGINT NOT NULL,
    numero_devolucao  VARCHAR(40),
    item_id           BIGINT,
    produto_id        BIGINT,
    produto_descricao VARCHAR(200),
    quantidade        NUMERIC(12,2) NOT NULL,
    manifesto         VARCHAR(40),
    placa             VARCHAR(12),
    motorista         VARCHAR(120),
    viagem_id         BIGINT,
    observacao        TEXT,
    criado_por        VARCHAR(120),
    criado_em         TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    atualizado_por    VARCHAR(120),
    atualizado_em     TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    is_deleted        BOOLEAN NOT NULL DEFAULT FALSE,
    deleted_at        TIMESTAMP,
    deleted_by_nome   VARCHAR(120),
    CONSTRAINT ck_cross_movimentos_tipo CHECK (tipo IN ('RECEBIDO_CROSS', 'EMBARQUE')),
    CONSTRAINT ck_cross_movimentos_qtd  CHECK (quantidade >= 0)
);

CREATE INDEX IF NOT EXISTS ix_cross_movimentos_dev       ON cross_movimentos (devolucao_id) WHERE is_deleted = FALSE;
CREATE INDEX IF NOT EXISTS ix_cross_movimentos_manifesto ON cross_movimentos (manifesto)    WHERE is_deleted = FALSE;

ALTER TABLE cross_movimentos ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "acesso_total_anon" ON cross_movimentos;
CREATE POLICY "acesso_total_anon" ON cross_movimentos FOR ALL TO anon USING (true) WITH CHECK (true);

-- Perfil novo CROSS (Logins e Senhas → departamento/papel).
ALTER TABLE departamentos DROP CONSTRAINT IF EXISTS departamentos_role_check;
ALTER TABLE departamentos ADD  CONSTRAINT departamentos_role_check
  CHECK (role IN ('SAC', 'CD', 'FINANCEIRO', 'MANUTENCAO', 'GESTOR', 'ADMIN', 'CROSS'));

INSERT INTO departamentos (nome, role, cargo, ativo)
VALUES ('CROSS PALMAS', 'CROSS', 'Conferente Cross Palmas', TRUE)
ON CONFLICT (nome) DO NOTHING;
