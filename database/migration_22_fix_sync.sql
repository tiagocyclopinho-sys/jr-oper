-- =============================================================================
-- MIGRACAO 22 - CORRECAO DA SINCRONIZACAO (dados nao compartilhavam entre
-- aparelhos). Diagnostico de 21/08/2026, validado contra o banco de producao.
--
-- SINTOMA: cadastros mestre (motoristas, veiculos, ajudantes, usuarios)
-- sincronizavam, mas NENHUMA tabela transacional recebia registros:
--   ocorrencias_devolucao=0  itens_devolucao=0  ocorrencias_rota=0
--   audit_logs=0  resumo_diario_cd=0  retencoes_frota=0  clientes=0 ...
--
-- CAUSA: o POST do PostgREST era rejeitado com 400 e o cloudStore.upsert()
-- so fazia console.warn() - falha 100% silenciosa. Tres motivos somados:
--   (1) colunas que o app grava e que NUNCA existiram no schema;
--   (2) chaves estrangeiras violadas (o push manda filho antes do pai);
--   (3) NOT NULL em colunas que o app grava como null.
--
-- Rode este arquivo inteiro no SQL Editor do Supabase. E idempotente.
-- =============================================================================

BEGIN;

-- -----------------------------------------------------------------------
-- 22.1 COLUNAS AUSENTES
-- Confirmado por sondagem no banco de producao: estas colunas sao gravadas
-- pelo store.js em TODA devolucao/resumo e nao existiam. Bastava uma delas
-- para o PostgREST recusar o lote inteiro com PGRST204
-- ("Could not find the 'X' column ... in the schema cache").
-- -----------------------------------------------------------------------
ALTER TABLE ocorrencias_devolucao ADD COLUMN IF NOT EXISTS motorista_id       BIGINT;
ALTER TABLE ocorrencias_devolucao ADD COLUMN IF NOT EXISTS fotos_investigacao JSONB DEFAULT '[]'::jsonb;
ALTER TABLE ocorrencias_devolucao ADD COLUMN IF NOT EXISTS itens              JSONB DEFAULT '[]'::jsonb;
ALTER TABLE ocorrencias_devolucao ADD COLUMN IF NOT EXISTS atualizado_por     VARCHAR(120);
ALTER TABLE ocorrencias_devolucao ADD COLUMN IF NOT EXISTS data_entrada_cd    TIMESTAMPTZ;
ALTER TABLE ocorrencias_devolucao ADD COLUMN IF NOT EXISTS requisito          VARCHAR(120);

-- resumo_diario_cd guarda os blocos do formulario como objeto aninhado
ALTER TABLE resumo_diario_cd      ADD COLUMN IF NOT EXISTS recebimento        JSONB DEFAULT '{}'::jsonb;
ALTER TABLE resumo_diario_cd      ADD COLUMN IF NOT EXISTS expedicao          JSONB DEFAULT '{}'::jsonb;

-- -----------------------------------------------------------------------
-- 22.2 NOT NULL QUE O APP NAO CONSEGUE HONRAR
-- store.js grava "parseInt(x) || null" nesses campos. Um unico registro
-- sem carga/veiculo/motorista derrubava o lote inteiro (SQLSTATE 23502).
-- -----------------------------------------------------------------------
ALTER TABLE ocorrencias_rota ALTER COLUMN carga_id     DROP NOT NULL;
ALTER TABLE ocorrencias_rota ALTER COLUMN veiculo_id   DROP NOT NULL;
ALTER TABLE ocorrencias_rota ALTER COLUMN motorista_id DROP NOT NULL;
ALTER TABLE itens_devolucao  ALTER COLUMN ocorrencia_devolucao_id DROP NOT NULL;
ALTER TABLE itens_devolucao  ALTER COLUMN produto_id   DROP NOT NULL;

-- -----------------------------------------------------------------------
-- 22.3 CHAVES ESTRANGEIRAS - a causa mais estrutural
--
-- Este app e offline-first: cada aparelho gera os proprios ids e o
-- cloudStore empurra TABELAS INTEIRAS, uma por vez, sem ordem topologica
-- (ocorrencias_devolucao e a PRIMEIRA do array de mappings; cargas e
-- clientes sao empurradas DEPOIS). Ou seja: o filho sempre chega antes do
-- pai e o Postgres recusa com 23503 - em todo ciclo, para sempre.
-- Reordenar o push (feito no cloudStore.js) resolve o caso normal, mas nao
-- o caso real de dois aparelhos offline criando registros cruzados.
--
-- Decisao: manter as COLUNAS de relacionamento (relatorios e views
-- continuam funcionando por JOIN) e remover a IMPOSICAO rigida da FK nas
-- tabelas sincronizadas. A integridade passa a ser responsabilidade do
-- app, que e quem detem a verdade nesse modelo. As FKs entre tabelas que
-- NAO sincronizam continuam intactas.
-- -----------------------------------------------------------------------
ALTER TABLE cargas                DROP CONSTRAINT IF EXISTS cargas_motorista_id_fkey;
ALTER TABLE cargas                DROP CONSTRAINT IF EXISTS cargas_ajudante_id_fkey;
ALTER TABLE cargas                DROP CONSTRAINT IF EXISTS cargas_veiculo_id_fkey;
ALTER TABLE cargas                DROP CONSTRAINT IF EXISTS cargas_deleted_by_usuario_id_fkey;

ALTER TABLE ocorrencias_devolucao DROP CONSTRAINT IF EXISTS ocorrencias_devolucao_carga_id_fkey;
ALTER TABLE ocorrencias_devolucao DROP CONSTRAINT IF EXISTS ocorrencias_devolucao_cliente_id_fkey;
ALTER TABLE ocorrencias_devolucao DROP CONSTRAINT IF EXISTS ocorrencias_devolucao_veiculo_id_fkey;
ALTER TABLE ocorrencias_devolucao DROP CONSTRAINT IF EXISTS ocorrencias_devolucao_separador_id_fkey;
ALTER TABLE ocorrencias_devolucao DROP CONSTRAINT IF EXISTS ocorrencias_devolucao_conferente_id_fkey;
ALTER TABLE ocorrencias_devolucao DROP CONSTRAINT IF EXISTS ocorrencias_devolucao_gestor_id_fkey;
ALTER TABLE ocorrencias_devolucao DROP CONSTRAINT IF EXISTS ocorrencias_devolucao_setor_encaminhado_id_fkey;
ALTER TABLE ocorrencias_devolucao DROP CONSTRAINT IF EXISTS ocorrencias_devolucao_criado_por_usuario_id_fkey;
ALTER TABLE ocorrencias_devolucao DROP CONSTRAINT IF EXISTS ocorrencias_devolucao_deleted_by_usuario_id_fkey;

ALTER TABLE itens_devolucao       DROP CONSTRAINT IF EXISTS itens_devolucao_ocorrencia_devolucao_id_fkey;
ALTER TABLE itens_devolucao       DROP CONSTRAINT IF EXISTS itens_devolucao_produto_id_fkey;
ALTER TABLE itens_devolucao       DROP CONSTRAINT IF EXISTS itens_devolucao_deleted_by_usuario_id_fkey;

ALTER TABLE ocorrencias_rota      DROP CONSTRAINT IF EXISTS ocorrencias_rota_carga_id_fkey;
ALTER TABLE ocorrencias_rota      DROP CONSTRAINT IF EXISTS ocorrencias_rota_veiculo_id_fkey;
ALTER TABLE ocorrencias_rota      DROP CONSTRAINT IF EXISTS ocorrencias_rota_motorista_id_fkey;
ALTER TABLE ocorrencias_rota      DROP CONSTRAINT IF EXISTS ocorrencias_rota_mecanico_responsavel_id_fkey;
ALTER TABLE ocorrencias_rota      DROP CONSTRAINT IF EXISTS ocorrencias_rota_deleted_by_usuario_id_fkey;

ALTER TABLE relatorios_divergencia  DROP CONSTRAINT IF EXISTS relatorios_divergencia_ocorrencia_devolucao_id_fkey;
ALTER TABLE relatorios_divergencia  DROP CONSTRAINT IF EXISTS relatorios_divergencia_ocorrencia_id_fkey;

ALTER TABLE auditoria_produtividade DROP CONSTRAINT IF EXISTS auditoria_produtividade_usuario_id_fkey;
ALTER TABLE auditoria_produtividade DROP CONSTRAINT IF EXISTS auditoria_produtividade_setor_id_fkey;
ALTER TABLE auditoria_produtividade DROP CONSTRAINT IF EXISTS auditoria_produtividade_ocorrencia_devolucao_id_fkey;
ALTER TABLE auditoria_produtividade DROP CONSTRAINT IF EXISTS auditoria_produtividade_ocorrencia_rota_id_fkey;

-- audit_logs.usuario_id grava 0 ("SISTEMA") quando nao ha usuario logado.
-- 0 nao existe em usuarios, entao TODA a trilha de auditoria (ate 1000
-- registros por lote) era recusada de uma vez so.
ALTER TABLE audit_logs            DROP CONSTRAINT IF EXISTS audit_logs_usuario_id_fkey;

ALTER TABLE colaboradores_cd      DROP CONSTRAINT IF EXISTS colaboradores_cd_deleted_by_usuario_id_fkey;
ALTER TABLE usuarios              DROP CONSTRAINT IF EXISTS usuarios_setor_id_fkey;
ALTER TABLE retencoes_frota       DROP CONSTRAINT IF EXISTS retencoes_frota_veiculo_id_fkey;
ALTER TABLE trocas_veiculos       DROP CONSTRAINT IF EXISTS trocas_veiculos_deleted_by_usuario_id_fkey;
ALTER TABLE veiculos              DROP CONSTRAINT IF EXISTS veiculos_deleted_by_usuario_id_fkey;
ALTER TABLE motoristas            DROP CONSTRAINT IF EXISTS motoristas_deleted_by_usuario_id_fkey;
ALTER TABLE ajudantes             DROP CONSTRAINT IF EXISTS ajudantes_deleted_by_usuario_id_fkey;
ALTER TABLE clientes              DROP CONSTRAINT IF EXISTS clientes_deleted_by_usuario_id_fkey;
ALTER TABLE produtos              DROP CONSTRAINT IF EXISTS produtos_deleted_by_usuario_id_fkey;

-- indices para nao perder desempenho dos JOINs agora sem FK
CREATE INDEX IF NOT EXISTS idx_dev_carga     ON ocorrencias_devolucao(carga_id);
CREATE INDEX IF NOT EXISTS idx_dev_cliente   ON ocorrencias_devolucao(cliente_id);
CREATE INDEX IF NOT EXISTS idx_dev_motorista ON ocorrencias_devolucao(motorista_id);
CREATE INDEX IF NOT EXISTS idx_itens_dev     ON itens_devolucao(ocorrencia_devolucao_id);

COMMIT;

-- Recarrega o cache de schema do PostgREST - sem isso, colunas recem
-- criadas continuam devolvendo PGRST204 por alguns minutos.
NOTIFY pgrst, 'reload schema';
