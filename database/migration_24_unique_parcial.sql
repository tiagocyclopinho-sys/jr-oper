-- =============================================================================
-- MIGRACAO 24 - UNIQUE que nao tolera campo em branco (22/08/2026)
--
-- SINTOMA: dos 39 motoristas da planilha Dados SAC (aba "Motorista"), apenas
-- 2 estavam na nuvem - e os 2 eram justamente os falsos: o placeholder
-- "A cadastrar" do seed (cnh 00000000000) e um "TESTE CLAUDE IGNORAR"
-- (cnh 99999999999). Nenhum motorista real subiu.
--
-- CAUSA: a planilha nao tem coluna de CNH, entao os 39 registros embarcados
-- em mockData.js tem cnh: "". No banco, cnh e VARCHAR(20) UNIQUE NOT NULL.
-- Em Postgres varios NULL convivem numa coluna UNIQUE, mas varias strings
-- VAZIAS nao: '' e um valor como outro qualquer. Da segunda linha em diante
-- o lote inteiro era recusado com 23505.
--
-- Passavam so os registros com CNH distinta - exatamente os dois de teste.
--
-- CORRECAO: trocar o UNIQUE rigido por um INDICE UNICO PARCIAL, que ignora
-- branco e nulo. A regra de negocio continua valendo (nao existem dois
-- motoristas com a MESMA CNH preenchida), mas quem ainda nao teve a CNH
-- cadastrada deixa de bloquear a tabela inteira.
--
-- Aplicado tambem as demais colunas UNIQUE que podem receber branco vindo de
-- planilha ou de formulario com campo opcional - para nao repetir o mesmo
-- travamento silencioso em outro cadastro daqui a uma semana.
--
-- Rode no SQL Editor do Supabase. E idempotente.
-- =============================================================================

BEGIN;

-- -----------------------------------------------------------------------
-- 24.1 MOTORISTAS - o bloqueio observado
-- -----------------------------------------------------------------------
ALTER TABLE motoristas DROP CONSTRAINT IF EXISTS motoristas_cnh_key;
ALTER TABLE motoristas ALTER COLUMN cnh DROP NOT NULL;
DROP INDEX IF EXISTS uq_motoristas_cnh;
CREATE UNIQUE INDEX uq_motoristas_cnh
  ON motoristas (cnh) WHERE cnh IS NOT NULL AND cnh <> '';

-- -----------------------------------------------------------------------
-- 24.2 MESMO PADRAO NOS DEMAIS CADASTROS
-- ajudantes.cpf hoje escapa por acaso (o app nem envia a chave, entao vira
-- NULL e varios NULL convivem). Basta alguem passar a gravar '' para cair
-- no mesmo buraco.
-- -----------------------------------------------------------------------
ALTER TABLE ajudantes DROP CONSTRAINT IF EXISTS ajudantes_cpf_key;
DROP INDEX IF EXISTS uq_ajudantes_cpf;
CREATE UNIQUE INDEX uq_ajudantes_cpf
  ON ajudantes (cpf) WHERE cpf IS NOT NULL AND cpf <> '';

ALTER TABLE veiculos DROP CONSTRAINT IF EXISTS veiculos_placa_key;
ALTER TABLE veiculos ALTER COLUMN placa DROP NOT NULL;
DROP INDEX IF EXISTS uq_veiculos_placa;
CREATE UNIQUE INDEX uq_veiculos_placa
  ON veiculos (placa) WHERE placa IS NOT NULL AND placa <> '';

ALTER TABLE usuarios DROP CONSTRAINT IF EXISTS usuarios_email_key;
DROP INDEX IF EXISTS uq_usuarios_email;
CREATE UNIQUE INDEX uq_usuarios_email
  ON usuarios (email) WHERE email IS NOT NULL AND email <> '';

ALTER TABLE cargas DROP CONSTRAINT IF EXISTS cargas_numero_carga_key;
ALTER TABLE cargas ALTER COLUMN numero_carga DROP NOT NULL;
DROP INDEX IF EXISTS uq_cargas_numero;
CREATE UNIQUE INDEX uq_cargas_numero
  ON cargas (numero_carga) WHERE numero_carga IS NOT NULL AND numero_carga <> '';

ALTER TABLE produtos DROP CONSTRAINT IF EXISTS produtos_codigo_produto_key;
DROP INDEX IF EXISTS uq_produtos_codigo;
CREATE UNIQUE INDEX uq_produtos_codigo
  ON produtos (codigo_produto) WHERE codigo_produto IS NOT NULL AND codigo_produto <> '';

-- Numeros de protocolo/documento: continuam unicos quando preenchidos (e o
-- 23505 continua alimentando a aba "Conflitos" do app), mas um registro
-- ainda sem numero para de derrubar a tabela toda.
ALTER TABLE ocorrencias_devolucao DROP CONSTRAINT IF EXISTS ocorrencias_devolucao_numero_protocolo_key;
ALTER TABLE ocorrencias_devolucao ALTER COLUMN numero_protocolo DROP NOT NULL;
DROP INDEX IF EXISTS uq_devolucao_protocolo;
CREATE UNIQUE INDEX uq_devolucao_protocolo
  ON ocorrencias_devolucao (numero_protocolo) WHERE numero_protocolo IS NOT NULL AND numero_protocolo <> '';

ALTER TABLE ocorrencias_rota DROP CONSTRAINT IF EXISTS ocorrencias_rota_numero_protocolo_key;
DROP INDEX IF EXISTS uq_rota_protocolo;
CREATE UNIQUE INDEX uq_rota_protocolo
  ON ocorrencias_rota (numero_protocolo) WHERE numero_protocolo IS NOT NULL AND numero_protocolo <> '';

ALTER TABLE retencoes_frota DROP CONSTRAINT IF EXISTS retencoes_frota_numero_retencao_key;
DROP INDEX IF EXISTS uq_retencao_numero;
CREATE UNIQUE INDEX uq_retencao_numero
  ON retencoes_frota (numero_retencao) WHERE numero_retencao IS NOT NULL AND numero_retencao <> '';

ALTER TABLE sinistros DROP CONSTRAINT IF EXISTS sinistros_numero_sinistro_key;
DROP INDEX IF EXISTS uq_sinistro_numero;
CREATE UNIQUE INDEX uq_sinistro_numero
  ON sinistros (numero_sinistro) WHERE numero_sinistro IS NOT NULL AND numero_sinistro <> '';

COMMIT;

NOTIFY pgrst, 'reload schema';

-- =============================================================================
-- 24.3 LIMPEZA DOS DOIS MOTORISTAS DE TESTE  (OPCIONAL - LEIA ANTES)
--
-- Sao os unicos 2 registros que a nuvem tem hoje em motoristas, e ambos sao
-- artificiais: o placeholder do script de carga inicial e um registro de
-- teste. Os 39 motoristas reais entram sozinhos no primeiro sync depois
-- desta migracao.
--
-- Rode o bloco abaixo SEPARADAMENTE, depois de conferir com o SELECT que
-- sao mesmo esses dois. Se algum motorista real ja tiver sido cadastrado
-- pela tela com esses nomes, NAO rode.
--
--   SELECT id, nome, cnh FROM motoristas;
--
--   DELETE FROM motoristas WHERE nome IN ('A cadastrar', 'TESTE CLAUDE IGNORAR');
-- =============================================================================
