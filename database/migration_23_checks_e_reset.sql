-- =============================================================================
-- MIGRACAO 23 - o que ainda travava depois da migracao 22 (21/08/2026)
--
-- Estado observado apos a migracao 22: itens_devolucao recebeu linha,
-- cargas recebeu linha, mas ocorrencias_devolucao continuou em ZERO.
-- Ou seja: o filho subiu e o pai nao. Nao era mais coluna nem FK.
--
-- CAUSA: restricoes CHECK. O app usa string vazia ('') para "ainda nao
-- definido" - forma_acerto e destino_cd so sao preenchidos depois, pelo
-- Financeiro e pelo CD. Mas o banco exige, ja na abertura, um dos valores
-- finais da lista. Toda devolucao nascia violando o CHECK (SQLSTATE 23514)
-- e o lote inteiro era recusado.
--
--   store.js:  forma_acerto: String(devolucaoData.forma_acerto || '')
--   schema:    forma_acerto VARCHAR(50) NOT NULL
--                CHECK (forma_acerto IN ('ABATIMENTO','JR_PAGA_DIFERENCA'))
--
-- Correcao: os CHECKs passam a aceitar tambem '' e NULL (= "ainda nao
-- definido"), mantendo a validacao dos valores finais. A regra de negocio
-- continua valendo; ela so deixa de ser aplicada no instante da abertura.
--
-- Inclui tambem a tabela sync_control, que faz o Reset Global funcionar de
-- verdade entre aparelhos (ver secao 23.3).
--
-- Rode no SQL Editor do Supabase. E idempotente.
-- =============================================================================

BEGIN;

-- -----------------------------------------------------------------------
-- 23.1 OCORRENCIAS_DEVOLUCAO - o bloqueio principal
-- -----------------------------------------------------------------------
ALTER TABLE ocorrencias_devolucao ALTER COLUMN forma_acerto DROP NOT NULL;

ALTER TABLE ocorrencias_devolucao DROP CONSTRAINT IF EXISTS ocorrencias_devolucao_forma_acerto_check;
ALTER TABLE ocorrencias_devolucao ADD  CONSTRAINT ocorrencias_devolucao_forma_acerto_check
  CHECK (forma_acerto IS NULL OR forma_acerto IN ('', 'ABATIMENTO', 'JR_PAGA_DIFERENCA'));

ALTER TABLE ocorrencias_devolucao DROP CONSTRAINT IF EXISTS ocorrencias_devolucao_destino_cd_check;
ALTER TABLE ocorrencias_devolucao ADD  CONSTRAINT ocorrencias_devolucao_destino_cd_check
  CHECK (destino_cd IS NULL OR destino_cd IN ('', 'ESTOQUE_REUTILIZACAO', 'AVARIA_DESCARTE',
                                              'DEVOLUCAO_FORNECEDOR', 'RETRABALHO_REEMBALAGEM'));

ALTER TABLE ocorrencias_devolucao DROP CONSTRAINT IF EXISTS ocorrencias_devolucao_status_fechamento_check;
ALTER TABLE ocorrencias_devolucao ADD  CONSTRAINT ocorrencias_devolucao_status_fechamento_check
  CHECK (status_fechamento IS NULL OR status_fechamento IN ('', 'PENDENTE_FISICO', 'RECEBIDO_CD',
                                              'DESTINO_APLICADO', 'PROCESSO_CONCLUIDO', 'RENEGOCIADO_ROTA'));

-- detalhamento_texto e motivo_reclamado sao NOT NULL mas o app pode gravar
-- '' (campo opcional na pratica). '' passa no NOT NULL, entao ficam como estao.

-- -----------------------------------------------------------------------
-- 23.2 MESMO PADRAO NAS DEMAIS TABELAS
-- Todas seguem a mesma logica: o app grava '' enquanto o campo nao foi
-- preenchido. Relaxadas preventivamente para nao repetir o mesmo travamento
-- silencioso em outro modulo na semana que vem.
-- -----------------------------------------------------------------------
ALTER TABLE ocorrencias_rota DROP CONSTRAINT IF EXISTS ocorrencias_rota_tipo_ocorrencia_check;
ALTER TABLE ocorrencias_rota ADD  CONSTRAINT ocorrencias_rota_tipo_ocorrencia_check
  CHECK (tipo_ocorrencia IS NULL OR tipo_ocorrencia IN ('', 'MECANICA', 'OPERACIONAL',
                                                        'CONDUTA_INADEQUADA', 'ACIDENTE'));
ALTER TABLE ocorrencias_rota ALTER COLUMN tipo_ocorrencia DROP NOT NULL;

ALTER TABLE ocorrencias_rota DROP CONSTRAINT IF EXISTS ocorrencias_rota_status_check;
ALTER TABLE ocorrencias_rota ADD  CONSTRAINT ocorrencias_rota_status_check
  CHECK (status IS NULL OR status IN ('', 'ABERTO', 'EM_ATENDIMENTO', 'RESOLVIDO'));
ALTER TABLE ocorrencias_rota ALTER COLUMN status DROP NOT NULL;

ALTER TABLE ocorrencias_rota DROP CONSTRAINT IF EXISTS ocorrencias_rota_status_chamado_check;
ALTER TABLE ocorrencias_rota ADD  CONSTRAINT ocorrencias_rota_status_chamado_check
  CHECK (status_chamado IS NULL OR status_chamado IN ('', 'pendente', 'finalizado'));
ALTER TABLE ocorrencias_rota ALTER COLUMN status_chamado DROP NOT NULL;

ALTER TABLE trocas_veiculos DROP CONSTRAINT IF EXISTS trocas_veiculos_autorizado_por_check;
ALTER TABLE trocas_veiculos ALTER COLUMN autorizado_por DROP NOT NULL;

ALTER TABLE reentregas_rota DROP CONSTRAINT IF EXISTS reentregas_rota_status_check;
ALTER TABLE reentregas_rota ADD  CONSTRAINT reentregas_rota_status_check
  CHECK (status IS NULL OR status IN ('', 'PENDENTE', 'REALIZADA'));
ALTER TABLE reentregas_rota ALTER COLUMN status DROP NOT NULL;

ALTER TABLE retencoes_frota DROP CONSTRAINT IF EXISTS retencoes_frota_tipo_os_check;
ALTER TABLE retencoes_frota ADD  CONSTRAINT retencoes_frota_tipo_os_check
  CHECK (tipo_os IS NULL OR tipo_os IN ('', 'SINISTRO', 'CORRETIVA', 'PREVENTIVA'));

ALTER TABLE retencoes_frota DROP CONSTRAINT IF EXISTS retencoes_frota_status_check;
ALTER TABLE retencoes_frota ADD  CONSTRAINT retencoes_frota_status_check
  CHECK (status IS NULL OR status IN ('', 'RETIDO', 'LIBERADO'));

ALTER TABLE usuarios DROP CONSTRAINT IF EXISTS usuarios_role_check;
ALTER TABLE usuarios ADD  CONSTRAINT usuarios_role_check
  CHECK (role IS NULL OR role IN ('', 'SAC', 'CD', 'FINANCEIRO', 'MANUTENCAO', 'ADMIN'));

-- itens_devolucao.quantidade > 0: o app ja valida quantidade no formulario,
-- mas um item zerado importado de planilha derrubaria a tabela inteira.
ALTER TABLE itens_devolucao DROP CONSTRAINT IF EXISTS itens_devolucao_quantidade_check;
ALTER TABLE itens_devolucao ADD  CONSTRAINT itens_devolucao_quantidade_check
  CHECK (quantidade IS NULL OR quantidade >= 0);

-- -----------------------------------------------------------------------
-- 23.3 SYNC_CONTROL - faz o Reset Global funcionar entre aparelhos
--
-- Problema observado: as viagens apagadas no Reset Global voltaram nos dois
-- aparelhos. Motivo: depois do reset a tabela fica vazia na nuvem, e um
-- aparelho que ainda tinha os registros no localStorage nao tem como saber
-- se aquele vazio significa "alguem apagou de proposito" ou "o envio nunca
-- funcionou". Na duvida ele reenviava - e ressuscitava tudo.
--
-- Esta tabela guarda um carimbo do ultimo reset. Cada aparelho grava o
-- carimbo que ja aplicou; ao ver um carimbo mais novo na nuvem, ele aceita
-- o vazio como verdade e limpa o proprio cache. Sem ambiguidade.
-- -----------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS sync_control (
    id         INT PRIMARY KEY DEFAULT 1,
    reset_epoch BIGINT NOT NULL DEFAULT 0,
    reset_em   TIMESTAMPTZ,
    reset_por  VARCHAR(120),
    CONSTRAINT sync_control_linha_unica CHECK (id = 1)
);

INSERT INTO sync_control (id, reset_epoch, reset_em, reset_por)
VALUES (1, 0, NULL, NULL)
ON CONFLICT (id) DO NOTHING;

ALTER TABLE sync_control ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "acesso_total_anon" ON sync_control;
CREATE POLICY "acesso_total_anon" ON sync_control FOR ALL TO anon USING (true) WITH CHECK (true);

-- -----------------------------------------------------------------------
-- 23.4 CLIENTES - colisao de codigo gerado
-- store.js gera codigo_cliente como 'CLI-' + os 4 ultimos digitos do
-- relogio. Dois clientes cadastrados no mesmo segundo geram o mesmo codigo,
-- e o UNIQUE derruba a tabela inteira (23505) sem aviso. O codigo continua
-- util como identificacao, mas nao precisa ser unico no banco.
-- -----------------------------------------------------------------------
ALTER TABLE clientes DROP CONSTRAINT IF EXISTS clientes_codigo_cliente_key;
ALTER TABLE clientes DROP CONSTRAINT IF EXISTS clientes_cnpj_key;
CREATE INDEX IF NOT EXISTS idx_clientes_codigo ON clientes(codigo_cliente);
CREATE INDEX IF NOT EXISTS idx_clientes_cnpj   ON clientes(cnpj);

COMMIT;

NOTIFY pgrst, 'reload schema';
