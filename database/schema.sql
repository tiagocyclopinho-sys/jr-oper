-- =============================================================================
-- BANCO DE DADOS RELACIONAL - SISTEMA JR SAC & LOGÍSTICA CORPORATIVA
-- Arquitetura 3FN de Custo Zero (PostgreSQL / Supabase)
-- VERSÃO PRODUÇÃO: com Row Level Security configurado para acesso via anon key
-- =============================================================================

-- 1. TABELA DE SETORES CORPORATIVOS
CREATE TABLE IF NOT EXISTS setores (
    id SERIAL PRIMARY KEY,
    codigo VARCHAR(20) UNIQUE NOT NULL,
    nome VARCHAR(100) NOT NULL,
    descricao TEXT,
    criado_em TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- 2. TABELA DE USUÁRIOS E PERFIS DE ACESSO (ROLES)
CREATE TABLE IF NOT EXISTS usuarios (
    id SERIAL PRIMARY KEY,
    nome VARCHAR(120) NOT NULL,
    email VARCHAR(150) UNIQUE NOT NULL,
    senha_hash VARCHAR(255) NOT NULL,
    setor_id INT REFERENCES setores(id) ON DELETE SET NULL,
    role VARCHAR(30) NOT NULL CHECK (role IN ('SAC', 'CD', 'FINANCEIRO', 'MANUTENCAO', 'ADMIN')),
    cargo VARCHAR(80),
    ativo BOOLEAN DEFAULT TRUE,
    criado_em TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- 3. CADASTROS AUXILIARES DA OPERAÇÃO LOGÍSTICA
CREATE TABLE IF NOT EXISTS motoristas (
    id SERIAL PRIMARY KEY,
    nome VARCHAR(120) NOT NULL,
    cnh VARCHAR(20) UNIQUE NOT NULL,
    telefone VARCHAR(20),
    ativo BOOLEAN DEFAULT TRUE,
    data_admissao DATE,
    data_desligamento DATE
);

CREATE TABLE IF NOT EXISTS ajudantes (
    id SERIAL PRIMARY KEY,
    nome VARCHAR(120) NOT NULL,
    cpf VARCHAR(14) UNIQUE,
    ativo BOOLEAN DEFAULT TRUE
);

CREATE TABLE IF NOT EXISTS colaboradores_cd (
    id SERIAL PRIMARY KEY,
    chapa VARCHAR(20),
    nome VARCHAR(120) NOT NULL,
    cpf VARCHAR(14),
    funcao VARCHAR(80) NOT NULL,
    secao VARCHAR(100),
    ativo BOOLEAN DEFAULT TRUE,
    data_admissao DATE,
    data_desligamento DATE,
    is_deleted BOOLEAN DEFAULT FALSE,
    deleted_at TIMESTAMP NULL,
    deleted_by_usuario_id INT NULL REFERENCES usuarios(id),
    deleted_by_nome VARCHAR(120) NULL,
    criado_em TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS veiculos (
    id SERIAL PRIMARY KEY,
    placa VARCHAR(10) UNIQUE NOT NULL,
    modelo VARCHAR(80) NOT NULL,
    tipo VARCHAR(50) NOT NULL,
    capacidade_kg INT,
    ativo BOOLEAN DEFAULT TRUE
);

CREATE TABLE IF NOT EXISTS clientes (
    id SERIAL PRIMARY KEY,
    codigo_cliente VARCHAR(30) UNIQUE NOT NULL,
    razao_social VARCHAR(150) NOT NULL,
    cnpj VARCHAR(20) UNIQUE NOT NULL,
    cidade VARCHAR(80),
    uf VARCHAR(2)
);

CREATE TABLE IF NOT EXISTS produtos (
    id SERIAL PRIMARY KEY,
    codigo_produto VARCHAR(40) UNIQUE NOT NULL,
    descricao VARCHAR(200) NOT NULL,
    categoria VARCHAR(80),
    valor_unitario_padrao DECIMAL(10,2) DEFAULT 0.00
);

-- 4. GESTÃO DE CARGAS E ROTAS
CREATE TABLE IF NOT EXISTS cargas (
    id SERIAL PRIMARY KEY,
    numero_carga VARCHAR(40) UNIQUE NOT NULL,
    rota VARCHAR(100) NOT NULL,
    motorista_id INT REFERENCES motoristas(id),
    ajudante_id INT REFERENCES ajudantes(id),
    veiculo_id INT REFERENCES veiculos(id),
    data_saida DATE DEFAULT CURRENT_DATE
);

-- 5. MÓDULO 1: OCORRÊNCIAS DE DEVOLUÇÃO (SAC INTERNO)
CREATE TABLE IF NOT EXISTS ocorrencias_devolucao (
    id SERIAL PRIMARY KEY,
    numero_protocolo VARCHAR(30) UNIQUE NOT NULL,
    numero_devolucao VARCHAR(30),
    carga_id INT REFERENCES cargas(id),
    carga_numero VARCHAR(40),
    cliente_id INT REFERENCES clientes(id),
    cliente_nome VARCHAR(150),
    veiculo_id INT REFERENCES veiculos(id),
    veiculo_placa VARCHAR(20),
    rota_nome VARCHAR(100),
    nota_fiscal VARCHAR(40),
    motivo_reclamado VARCHAR(120) NOT NULL,
    valor_reclamado DECIMAL(12,2) NOT NULL DEFAULT 0.00,
    detalhamento_texto TEXT NOT NULL,
    foto_url TEXT,
    sem_itens BOOLEAN DEFAULT FALSE,
    observacao_sem_itens TEXT,
    cliente_emite_nf BOOLEAN DEFAULT FALSE,
    forma_acerto VARCHAR(50) NOT NULL CHECK (forma_acerto IN ('ABATIMENTO', 'JR_PAGA_DIFERENCA')),
    motivo_real_causa_raiz VARCHAR(150),
    tipo_erro VARCHAR(80),
    tipo_erro_outro TEXT,
    video_url TEXT,
    video_investigacao_url TEXT,
    descricao_monitoramento TEXT,
    separador_id INT REFERENCES usuarios(id),
    conferente_id INT REFERENCES usuarios(id),
    separador_apurado VARCHAR(120),
    conferente_apurado VARCHAR(120),
    setor_encaminhado_id INT REFERENCES setores(id),
    acao_tomada TEXT,
    gestor_id INT REFERENCES usuarios(id),
    acao_gestor TEXT,
    desconto_produtividade_gestor BOOLEAN DEFAULT FALSE,
    status_gestao VARCHAR(30) DEFAULT 'PENDENTE',
    data_acao_gestor TIMESTAMP,
    destino_cd VARCHAR(50) CHECK (destino_cd IN (
        'ESTOQUE_REUTILIZACAO', 
        'AVARIA_DESCARTE', 
        'DEVOLUCAO_FORNECEDOR', 
        'RETRABALHO_REEMBALAGEM'
    )),
    status_fechamento VARCHAR(50) NOT NULL DEFAULT 'PENDENTE_FISICO' CHECK (status_fechamento IN (
        'PENDENTE_FISICO', 
        'RECEBIDO_CD', 
        'DESTINO_APLICADO', 
        'PROCESSO_CONCLUIDO', 
        'RENEGOCIADO_ROTA'
    )),
    criado_por_usuario_id INT REFERENCES usuarios(id),
    criado_em TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    atualizado_em TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- 6. ITENS DA DEVOLUÇÃO
CREATE TABLE IF NOT EXISTS itens_devolucao (
    id SERIAL PRIMARY KEY,
    ocorrencia_devolucao_id INT NOT NULL REFERENCES ocorrencias_devolucao(id) ON DELETE CASCADE,
    produto_id INT NOT NULL REFERENCES produtos(id),
    quantidade INT NOT NULL CHECK (quantidade > 0),
    valor_unitario DECIMAL(10,2) NOT NULL,
    valor_total DECIMAL(12,2) GENERATED ALWAYS AS (quantidade * valor_unitario) STORED,
    motivo_item VARCHAR(100)
);

-- 6B. RELATÓRIOS DE DIVERGÊNCIA DO CD
CREATE TABLE IF NOT EXISTS relatorios_divergencia (
    id SERIAL PRIMARY KEY,
    ocorrencia_devolucao_id INT REFERENCES ocorrencias_devolucao(id) ON DELETE CASCADE,
    numero_protocolo VARCHAR(30),
    numero_devolucao VARCHAR(30),
    motorista_nome VARCHAR(120),
    veiculo_placa VARCHAR(20),
    rota_nome VARCHAR(100),
    cliente_nome VARCHAR(150),
    tipo VARCHAR(50) DEFAULT 'DESCONTO_MOTORISTA',
    gerado_em TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    -- gravado por gerarRelatorioDivergencia() em app.js (nomes de campo diferentes das colunas acima)
    ocorrencia_id BIGINT REFERENCES ocorrencias_devolucao(id) ON DELETE CASCADE,
    protocolo VARCHAR(30),
    motorista VARCHAR(120),
    ajudante VARCHAR(120),
    veiculo VARCHAR(20),
    rota VARCHAR(100),
    cliente VARCHAR(150),
    tipo_erro VARCHAR(80),
    itens_divergentes JSONB,
    valor_total_divergencia DECIMAL(12,2)
);

CREATE TABLE IF NOT EXISTS itens_relatorio_divergencia (
    id SERIAL PRIMARY KEY,
    relatorio_divergencia_id INT NOT NULL REFERENCES relatorios_divergencia(id) ON DELETE CASCADE,
    produto_id INT REFERENCES produtos(id),
    codigo_produto VARCHAR(40),
    descricao_produto VARCHAR(200),
    quantidade_esperada INT NOT NULL,
    quantidade_recebida INT NOT NULL,
    quantidade_faltante INT NOT NULL,
    motivo_divergencia VARCHAR(150)
);

-- 7. MÓDULO 2: OCORRÊNCIAS EM ROTA (FROTA / MANUTENÇÃO)
CREATE TABLE IF NOT EXISTS ocorrencias_rota (
    id SERIAL PRIMARY KEY,
    numero_protocolo VARCHAR(30) UNIQUE NOT NULL,
    carga_id INT NOT NULL REFERENCES cargas(id),
    veiculo_id INT NOT NULL REFERENCES veiculos(id),
    motorista_id INT NOT NULL REFERENCES motoristas(id),
    tipo_ocorrencia VARCHAR(50) NOT NULL CHECK (tipo_ocorrencia IN ('MECANICA', 'OPERACIONAL', 'CONDUTA_INADEQUADA', 'ACIDENTE')),
    localizacao TEXT,
    descricao TEXT NOT NULL,
    midia_fotos TEXT,
    midia_videos TEXT,
    status VARCHAR(30) NOT NULL DEFAULT 'ABERTO' CHECK (status IN ('ABERTO', 'EM_ATENDIMENTO', 'RESOLVIDO')),
    status_chamado VARCHAR(30) NOT NULL DEFAULT 'pendente' CHECK (status_chamado IN ('pendente', 'finalizado')),
    veiculo_parado BOOLEAN DEFAULT TRUE,
    mecanico_responsavel_id INT REFERENCES usuarios(id),
    acao_mecanico TEXT,
    pecas_trocadas TEXT,
    guincho_acionado BOOLEAN DEFAULT FALSE,
    custo_socorro DECIMAL(10,2) DEFAULT 0.00,
    retorno_manutencao_descricao TEXT,
    retorno_manutencao_data TIMESTAMP,
    retorno_manutencao_responsavel VARCHAR(120),
    criado_em TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    resolvido_em TIMESTAMP
);

-- 8. MÓDULO 4: TROCA DE VEÍCULOS NA ESCALA
CREATE TABLE IF NOT EXISTS trocas_veiculos (
    id SERIAL PRIMARY KEY,
    data DATE NOT NULL DEFAULT CURRENT_DATE,
    veiculo_escalado VARCHAR(20) NOT NULL,
    veiculo_trocado VARCHAR(20) NOT NULL,
    motivo_resumido VARCHAR(100) NOT NULL,
    motivo_outro VARCHAR(150),
    detalhamento TEXT NOT NULL,
    autorizado_por VARCHAR(100) NOT NULL CHECK (autorizado_por IN (
        'LUIZ EDUARDO', 'WELINTON', 'VICTOR HUGO', 'NÃO AUTORIZADO', 
        'GUSTAVO CARDOSO', 'MELQUIADES NETO', 'MARCOS ADRIANO', 'PAULO SILVA', 'ROBSON PINHEIRO'
    )),
    criado_em TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- 9. AUDITORIA E IMPACTOS EM PRODUTIVIDADE
CREATE TABLE IF NOT EXISTS auditoria_produtividade (
    id SERIAL PRIMARY KEY,
    usuario_id INT REFERENCES usuarios(id),
    setor_id INT REFERENCES setores(id),
    ocorrencia_devolucao_id INT REFERENCES ocorrencias_devolucao(id),
    ocorrencia_rota_id INT REFERENCES ocorrencias_rota(id),
    tipo_falha VARCHAR(80),
    valor_prejuizo DECIMAL(10,2) DEFAULT 0.00,
    pontos_desconto INT DEFAULT 0,
    observacoes TEXT,
    registrado_em TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    -- gravado por updateAcaoGestor() em store.js (identifica por nome, não por usuario_id)
    protocolo VARCHAR(30),
    separador_nome VARCHAR(120),
    conferente_nome VARCHAR(120),
    tipo_erro VARCHAR(80),
    motivo_causa_raiz VARCHAR(150),
    acao_gestor TEXT,
    gestor_id BIGINT
);

-- =============================================================================
-- 10. GOVERNANÇA: SOFT DELETE (LIXEIRA), AUDITORIA & VERSIONAMENTO
-- (PRIORIDADE 7a) Estas colunas/tabelas já existem e são usadas ativamente
-- no armazenamento local (js/store.js: softDelete, restoreItem, hardDelete,
-- logAudit, saveVersion, rollbackVersion). Antes desta alteração, o schema
-- remoto NÃO tinha essas colunas/tabelas — ao ativar o Supabase pelo painel
-- "Configurar Nuvem", a Lixeira/Auditoria/Versionamento falharia
-- silenciosamente por falta de estrutura no banco. Rodar este bloco ANTES
-- de qualquer ativação real da nuvem em produção.
-- =============================================================================

-- 10.1 Colunas de soft delete nas tabelas operacionais e de cadastro
ALTER TABLE ocorrencias_devolucao ADD COLUMN IF NOT EXISTS is_deleted BOOLEAN DEFAULT FALSE;
ALTER TABLE ocorrencias_devolucao ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMP NULL;
ALTER TABLE ocorrencias_devolucao ADD COLUMN IF NOT EXISTS deleted_by_usuario_id INT NULL REFERENCES usuarios(id);
ALTER TABLE ocorrencias_devolucao ADD COLUMN IF NOT EXISTS deleted_by_nome VARCHAR(120) NULL;

ALTER TABLE itens_devolucao ADD COLUMN IF NOT EXISTS is_deleted BOOLEAN DEFAULT FALSE;
ALTER TABLE itens_devolucao ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMP NULL;
ALTER TABLE itens_devolucao ADD COLUMN IF NOT EXISTS deleted_by_usuario_id INT NULL REFERENCES usuarios(id);
ALTER TABLE itens_devolucao ADD COLUMN IF NOT EXISTS deleted_by_nome VARCHAR(120) NULL;

ALTER TABLE ocorrencias_rota ADD COLUMN IF NOT EXISTS is_deleted BOOLEAN DEFAULT FALSE;
ALTER TABLE ocorrencias_rota ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMP NULL;
ALTER TABLE ocorrencias_rota ADD COLUMN IF NOT EXISTS deleted_by_usuario_id INT NULL REFERENCES usuarios(id);
ALTER TABLE ocorrencias_rota ADD COLUMN IF NOT EXISTS deleted_by_nome VARCHAR(120) NULL;

ALTER TABLE cargas ADD COLUMN IF NOT EXISTS is_deleted BOOLEAN DEFAULT FALSE;
ALTER TABLE cargas ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMP NULL;
ALTER TABLE cargas ADD COLUMN IF NOT EXISTS deleted_by_usuario_id INT NULL REFERENCES usuarios(id);
ALTER TABLE cargas ADD COLUMN IF NOT EXISTS deleted_by_nome VARCHAR(120) NULL;

ALTER TABLE produtos ADD COLUMN IF NOT EXISTS is_deleted BOOLEAN DEFAULT FALSE;
ALTER TABLE produtos ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMP NULL;
ALTER TABLE produtos ADD COLUMN IF NOT EXISTS deleted_by_usuario_id INT NULL REFERENCES usuarios(id);
ALTER TABLE produtos ADD COLUMN IF NOT EXISTS deleted_by_nome VARCHAR(120) NULL;

ALTER TABLE motoristas ADD COLUMN IF NOT EXISTS is_deleted BOOLEAN DEFAULT FALSE;
ALTER TABLE motoristas ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMP NULL;
ALTER TABLE motoristas ADD COLUMN IF NOT EXISTS deleted_by_usuario_id INT NULL REFERENCES usuarios(id);
ALTER TABLE motoristas ADD COLUMN IF NOT EXISTS deleted_by_nome VARCHAR(120) NULL;

ALTER TABLE ajudantes ADD COLUMN IF NOT EXISTS is_deleted BOOLEAN DEFAULT FALSE;
ALTER TABLE ajudantes ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMP NULL;
ALTER TABLE ajudantes ADD COLUMN IF NOT EXISTS deleted_by_usuario_id INT NULL REFERENCES usuarios(id);
ALTER TABLE ajudantes ADD COLUMN IF NOT EXISTS deleted_by_nome VARCHAR(120) NULL;

ALTER TABLE veiculos ADD COLUMN IF NOT EXISTS is_deleted BOOLEAN DEFAULT FALSE;
ALTER TABLE veiculos ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMP NULL;
ALTER TABLE veiculos ADD COLUMN IF NOT EXISTS deleted_by_usuario_id INT NULL REFERENCES usuarios(id);
ALTER TABLE veiculos ADD COLUMN IF NOT EXISTS deleted_by_nome VARCHAR(120) NULL;

ALTER TABLE clientes ADD COLUMN IF NOT EXISTS is_deleted BOOLEAN DEFAULT FALSE;
ALTER TABLE clientes ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMP NULL;
ALTER TABLE clientes ADD COLUMN IF NOT EXISTS deleted_by_usuario_id INT NULL REFERENCES usuarios(id);
ALTER TABLE clientes ADD COLUMN IF NOT EXISTS deleted_by_nome VARCHAR(120) NULL;

ALTER TABLE trocas_veiculos ADD COLUMN IF NOT EXISTS is_deleted BOOLEAN DEFAULT FALSE;
ALTER TABLE trocas_veiculos ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMP NULL;
ALTER TABLE trocas_veiculos ADD COLUMN IF NOT EXISTS deleted_by_usuario_id INT NULL REFERENCES usuarios(id);
ALTER TABLE trocas_veiculos ADD COLUMN IF NOT EXISTS deleted_by_nome VARCHAR(120) NULL;

-- 10.1b Campos usados por updateInvestigacao() (PRIORIDADE 1) que ainda não
-- existiam no schema remoto
ALTER TABLE ocorrencias_devolucao ADD COLUMN IF NOT EXISTS responsavel_analise VARCHAR(120) NULL;

-- 10.1c Migração e Novos Campos: Ocorrências de Frota em Rota (Etapa 1)
ALTER TABLE ocorrencias_rota DROP COLUMN IF EXISTS transcricao_audio_wa;
ALTER TABLE ocorrencias_rota DROP COLUMN IF EXISTS transcricao_audio_whatsapp;
ALTER TABLE ocorrencias_rota ADD COLUMN IF NOT EXISTS localizacao TEXT;
ALTER TABLE ocorrencias_rota ADD COLUMN IF NOT EXISTS status_chamado VARCHAR(30) DEFAULT 'pendente';
ALTER TABLE ocorrencias_rota ADD COLUMN IF NOT EXISTS retorno_manutencao_descricao TEXT;
ALTER TABLE ocorrencias_rota ADD COLUMN IF NOT EXISTS retorno_manutencao_data TIMESTAMP;
ALTER TABLE ocorrencias_rota ADD COLUMN IF NOT EXISTS retorno_manutencao_responsavel VARCHAR(120);

-- 10.2 Trilha de auditoria — espelha this.data.audit_logs do store.js local
CREATE TABLE IF NOT EXISTS audit_logs (
    id BIGSERIAL PRIMARY KEY,
    usuario_id INT REFERENCES usuarios(id),
    usuario_nome VARCHAR(120),
    data_hora TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    acao VARCHAR(60) NOT NULL,
    modulo VARCHAR(80) NOT NULL,
    registro_id VARCHAR(60),
    diff JSONB,
    user_agent TEXT
);
CREATE INDEX IF NOT EXISTS idx_audit_logs_modulo_registro ON audit_logs(modulo, registro_id);
CREATE INDEX IF NOT EXISTS idx_audit_logs_data_hora ON audit_logs(data_hora);

-- 10.3 Versionamento — espelha this.data.registro_versoes do store.js local
CREATE TABLE IF NOT EXISTS registro_versoes (
    id BIGSERIAL PRIMARY KEY,
    collection VARCHAR(80) NOT NULL,
    registro_id VARCHAR(60) NOT NULL,
    versao INT NOT NULL,
    dados_json JSONB NOT NULL,
    criado_por VARCHAR(120),
    criado_em TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_registro_versoes_collection_registro ON registro_versoes(collection, registro_id);

-- 10.4 Índices de soft delete (queries do dia a dia sempre filtram is_deleted = FALSE)
CREATE INDEX IF NOT EXISTS idx_devolucao_is_deleted ON ocorrencias_devolucao(is_deleted) WHERE is_deleted = FALSE;
CREATE INDEX IF NOT EXISTS idx_rota_is_deleted ON ocorrencias_rota(is_deleted) WHERE is_deleted = FALSE;
CREATE INDEX IF NOT EXISTS idx_cargas_is_deleted ON cargas(is_deleted) WHERE is_deleted = FALSE;
CREATE INDEX IF NOT EXISTS idx_clientes_is_deleted ON clientes(is_deleted) WHERE is_deleted = FALSE;
CREATE INDEX IF NOT EXISTS idx_produtos_is_deleted ON produtos(is_deleted) WHERE is_deleted = FALSE;

-- =============================================================================
-- 10.4b LIMPEZA DE VIEWS ANTIGAS (achado em 20/08/2026) — se este schema já
-- foi rodado antes (mesmo numa versão anterior, com as views ainda dentro
-- deste arquivo), as 6 views de BI podem já existir no banco e ainda
-- estarem "presas" ao tipo antigo (INTEGER) das colunas abaixo. Isso
-- bloqueia o ALTER COLUMN da seção 10.5 com o mesmo erro de sempre
-- ("cannot alter type of a column used by a view or rule"), mesmo esse
-- arquivo não criando mais nenhuma view. Removendo aqui, incondicionalmente
-- e de forma idempotente (IF EXISTS), garante que o schema.sql sempre
-- rode do zero independente do que sobrou de tentativas anteriores. As
-- views voltam a existir ao rodar database/schema_views.sql (Query 2) —
-- rodar esse arquivo de novo depois deste é obrigatório sempre que este
-- bloco disparar.
DROP VIEW IF EXISTS vw_bi_produtividade_equipe CASCADE;
DROP VIEW IF EXISTS vw_bi_devolucoes_causa_raiz CASCADE;
DROP VIEW IF EXISTS vw_bi_frota_veiculos_parados CASCADE;
DROP VIEW IF EXISTS vw_bi_controle_cd_pendencias CASCADE;
DROP VIEW IF EXISTS vw_bi_trocas_veiculos CASCADE;
DROP VIEW IF EXISTS vw_bi_disponibilidade_frota CASCADE;

-- =============================================================================
-- 10.5 CORREÇÃO DE TIPO: id gerado no cliente não cabe em INTEGER (32 bits)
-- (achado em 19/08/2026, antes do go-live) — o app gera id com Date.now(),
-- um número de 13 dígitos (hoje ~1,78 trilhão). O limite do INTEGER de 32
-- bits do Postgres é ~2,1 bilhões. Como a sincronização Local→Nuvem envia
-- esse id explicitamente (upsert por chave primária), TODA gravação nas
-- tabelas abaixo falhava com "integer out of range" ao tentar sincronizar
-- — silenciosamente, sem avisar o usuário, os dados ficavam presos só no
-- aparelho local. PRECISA rodar antes de qualquer VIEW ser criada (uma
-- view que dependa da coluna trava o ALTER COLUMN com o erro "cannot
-- alter type of a column used by a view or rule") — por isso este bloco
-- fica aqui, logo após as tabelas base, e não mais perto do fim do
-- arquivo. ALTER COLUMN TYPE é seguro de rodar de novo (idempotente na
-- prática — mudar um BIGINT para BIGINT não dá erro).
ALTER TABLE usuarios ALTER COLUMN id TYPE BIGINT;
ALTER TABLE motoristas ALTER COLUMN id TYPE BIGINT;
ALTER TABLE ajudantes ALTER COLUMN id TYPE BIGINT;
ALTER TABLE colaboradores_cd ALTER COLUMN id TYPE BIGINT;
ALTER TABLE veiculos ALTER COLUMN id TYPE BIGINT;
ALTER TABLE clientes ALTER COLUMN id TYPE BIGINT;
ALTER TABLE produtos ALTER COLUMN id TYPE BIGINT;
ALTER TABLE cargas ALTER COLUMN id TYPE BIGINT;
ALTER TABLE ocorrencias_devolucao ALTER COLUMN id TYPE BIGINT;
ALTER TABLE ocorrencias_rota ALTER COLUMN id TYPE BIGINT;
ALTER TABLE trocas_veiculos ALTER COLUMN id TYPE BIGINT;

-- Colunas que guardam uma referência (FK) a alguma das tabelas acima —
-- mesmo estouro se ficarem como INT.
ALTER TABLE colaboradores_cd ALTER COLUMN deleted_by_usuario_id TYPE BIGINT;
ALTER TABLE cargas ALTER COLUMN motorista_id TYPE BIGINT;
ALTER TABLE cargas ALTER COLUMN ajudante_id TYPE BIGINT;
ALTER TABLE cargas ALTER COLUMN veiculo_id TYPE BIGINT;
ALTER TABLE ocorrencias_devolucao ALTER COLUMN carga_id TYPE BIGINT;
ALTER TABLE ocorrencias_devolucao ALTER COLUMN cliente_id TYPE BIGINT;
ALTER TABLE ocorrencias_devolucao ALTER COLUMN veiculo_id TYPE BIGINT;
ALTER TABLE ocorrencias_devolucao ALTER COLUMN separador_id TYPE BIGINT;
ALTER TABLE ocorrencias_devolucao ALTER COLUMN conferente_id TYPE BIGINT;
ALTER TABLE ocorrencias_devolucao ALTER COLUMN gestor_id TYPE BIGINT;
ALTER TABLE ocorrencias_devolucao ALTER COLUMN criado_por_usuario_id TYPE BIGINT;
ALTER TABLE ocorrencias_rota ALTER COLUMN carga_id TYPE BIGINT;
ALTER TABLE ocorrencias_rota ALTER COLUMN veiculo_id TYPE BIGINT;
ALTER TABLE ocorrencias_rota ALTER COLUMN motorista_id TYPE BIGINT;
ALTER TABLE ocorrencias_rota ALTER COLUMN mecanico_responsavel_id TYPE BIGINT;
ALTER TABLE itens_devolucao ALTER COLUMN ocorrencia_devolucao_id TYPE BIGINT;
ALTER TABLE itens_devolucao ALTER COLUMN produto_id TYPE BIGINT;
ALTER TABLE relatorios_divergencia ALTER COLUMN ocorrencia_devolucao_id TYPE BIGINT;
ALTER TABLE itens_relatorio_divergencia ALTER COLUMN relatorio_divergencia_id TYPE BIGINT;
ALTER TABLE itens_relatorio_divergencia ALTER COLUMN produto_id TYPE BIGINT;
ALTER TABLE auditoria_produtividade ALTER COLUMN usuario_id TYPE BIGINT;
ALTER TABLE auditoria_produtividade ALTER COLUMN ocorrencia_devolucao_id TYPE BIGINT;
ALTER TABLE auditoria_produtividade ALTER COLUMN ocorrencia_rota_id TYPE BIGINT;
ALTER TABLE audit_logs ALTER COLUMN usuario_id TYPE BIGINT;

-- 10.6 CORREÇÃO DE TIPO (fase 2, achado em 20/08/2026) — completa a lista
-- da seção 10.5: estas 5 tabelas também recebem id gerado no cliente
-- (Date.now()) em store.js/app.js e ainda estavam com id SERIAL (INTEGER,
-- 32 bits), o que derrubava a sincronização com "integer out of range"
-- assim que o timestamp passasse de ~2,1 bilhões. audit_logs e
-- registro_versoes ficaram de fora desta lista de propósito — já nasceram
-- BIGSERIAL (seção 10.2/10.3) e não têm esse problema.
--
-- Mesma trava da seção 10.4b: mais de uma view de BI depende do "id" das
-- tabelas abaixo (achado na prática — vw_bi_produtividade_equipe em
-- auditoria_produtividade.id, vw_bi_devolucoes_causa_raiz em pelo menos
-- itens_devolucao.id/relatorios_divergencia.id). Em vez de descobrir view
-- por view a cada erro, derruba as 6 de uma vez (idempotente, IF EXISTS) —
-- mesma lista da seção 10.4b. Rodar database/schema_views.sql (Query 2) de
-- novo depois deste arquivo continua obrigatório.
DROP VIEW IF EXISTS vw_bi_produtividade_equipe CASCADE;
DROP VIEW IF EXISTS vw_bi_devolucoes_causa_raiz CASCADE;
DROP VIEW IF EXISTS vw_bi_frota_veiculos_parados CASCADE;
DROP VIEW IF EXISTS vw_bi_controle_cd_pendencias CASCADE;
DROP VIEW IF EXISTS vw_bi_trocas_veiculos CASCADE;
DROP VIEW IF EXISTS vw_bi_disponibilidade_frota CASCADE;
ALTER TABLE setores ALTER COLUMN id TYPE BIGINT;
ALTER TABLE itens_devolucao ALTER COLUMN id TYPE BIGINT;
ALTER TABLE relatorios_divergencia ALTER COLUMN id TYPE BIGINT;
ALTER TABLE itens_relatorio_divergencia ALTER COLUMN id TYPE BIGINT;
ALTER TABLE auditoria_produtividade ALTER COLUMN id TYPE BIGINT;

-- 10.7 COLUNAS QUE FALTAVAM (achado em 20/08/2026) — o app já lê/escreve
-- estes campos ativamente, mas o schema remoto nunca teve as colunas.
-- Como cloudStore.js envia o objeto local inteiro sem filtrar por coluna
-- conhecida (ver upsert() em js/cloudStore.js), qualquer chave que não
-- exista como coluna faz o PostgREST rejeitar o registro inteiro — a
-- gravação "funciona" localmente e nunca chega na nuvem, sem aviso nenhum
-- ao usuário.
--
-- veiculos.situacao: js/app.js filtra e exibe veículos por v.situacao
-- ('Ativo'/'Inativo') em uma dezena de telas; a tabela só tinha a boolean
-- "ativo", nunca usada pelo app. Backfill a partir de "ativo" para não
-- perder o estado dos veículos já cadastrados.
ALTER TABLE veiculos ADD COLUMN IF NOT EXISTS situacao VARCHAR(20) NOT NULL DEFAULT 'Ativo';
UPDATE veiculos SET situacao = CASE WHEN ativo THEN 'Ativo' ELSE 'Inativo' END WHERE situacao = 'Ativo';

-- ocorrencias_devolucao: js/app.js grava fotos_abertura/videos_abertura
-- (upload na abertura da ocorrência) e lê também videos_investigacao —
-- sempre como array. JSONB segue o mesmo padrão já usado em
-- resumo_diario_cd (seção 14) para listas que o app já trata como
-- array/objeto local, em vez de normalizar em tabelas à parte.
ALTER TABLE ocorrencias_devolucao ADD COLUMN IF NOT EXISTS fotos_abertura JSONB;
ALTER TABLE ocorrencias_devolucao ADD COLUMN IF NOT EXISTS videos_abertura JSONB;
ALTER TABLE ocorrencias_devolucao ADD COLUMN IF NOT EXISTS videos_investigacao JSONB;

-- motoristas.data_admissao/data_desligamento (achado em 20/08/2026, testando
-- contra a nuvem de produção de verdade): js/app.js coleta e exibe essas
-- datas no formulário e no dossiê do motorista (linhas 13533-13534 e
-- 1048-1049/1395-1396), mas a tabela nunca teve essas colunas — TODO
-- cadastro de motorista feito pelo app falhava a sincronização inteira com
-- "Could not find the 'data_admissao' column" (PGRST204), silenciosamente,
-- desde sempre. Motoristas reais provavelmente nunca chegaram na nuvem.
ALTER TABLE motoristas ADD COLUMN IF NOT EXISTS data_admissao DATE;
ALTER TABLE motoristas ADD COLUMN IF NOT EXISTS data_desligamento DATE;

-- =============================================================================
-- ÍNDICES PARA ALTA PERFORMANCE
-- =============================================================================
CREATE INDEX IF NOT EXISTS idx_devolucao_status ON ocorrencias_devolucao(status_fechamento);
CREATE INDEX IF NOT EXISTS idx_devolucao_separador ON ocorrencias_devolucao(separador_id);
CREATE INDEX IF NOT EXISTS idx_devolucao_conferente ON ocorrencias_devolucao(conferente_id);
CREATE INDEX IF NOT EXISTS idx_devolucao_causa ON ocorrencias_devolucao(motivo_real_causa_raiz);
CREATE INDEX IF NOT EXISTS idx_rota_veiculo_parado ON ocorrencias_rota(veiculo_parado) WHERE veiculo_parado = TRUE;
CREATE INDEX IF NOT EXISTS idx_auditoria_usuario ON auditoria_produtividade(usuario_id);

-- =============================================================================
-- PERMISSÕES DE ACESSO (ROW LEVEL SECURITY)
-- Permite leitura e escrita via chave anon pública (sem autenticação extra)
-- Isso é o modelo mais simples: todos da empresa veem e editam os dados
-- =============================================================================

-- Habilita RLS em todas as tabelas
ALTER TABLE setores ENABLE ROW LEVEL SECURITY;
ALTER TABLE usuarios ENABLE ROW LEVEL SECURITY;
ALTER TABLE motoristas ENABLE ROW LEVEL SECURITY;
ALTER TABLE ajudantes ENABLE ROW LEVEL SECURITY;
ALTER TABLE colaboradores_cd ENABLE ROW LEVEL SECURITY;
ALTER TABLE veiculos ENABLE ROW LEVEL SECURITY;
ALTER TABLE clientes ENABLE ROW LEVEL SECURITY;
ALTER TABLE produtos ENABLE ROW LEVEL SECURITY;
ALTER TABLE cargas ENABLE ROW LEVEL SECURITY;
ALTER TABLE ocorrencias_devolucao ENABLE ROW LEVEL SECURITY;
ALTER TABLE itens_devolucao ENABLE ROW LEVEL SECURITY;
ALTER TABLE relatorios_divergencia ENABLE ROW LEVEL SECURITY;
ALTER TABLE itens_relatorio_divergencia ENABLE ROW LEVEL SECURITY;
ALTER TABLE ocorrencias_rota ENABLE ROW LEVEL SECURITY;
ALTER TABLE trocas_veiculos ENABLE ROW LEVEL SECURITY;
ALTER TABLE auditoria_produtividade ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE registro_versoes ENABLE ROW LEVEL SECURITY;

-- Política: permite acesso total a usuários anônimos (toda a empresa usa a mesma chave)
DROP POLICY IF EXISTS "acesso_total_anon" ON setores;
CREATE POLICY "acesso_total_anon" ON setores FOR ALL TO anon USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS "acesso_total_anon" ON usuarios;
CREATE POLICY "acesso_total_anon" ON usuarios FOR ALL TO anon USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS "acesso_total_anon" ON motoristas;
CREATE POLICY "acesso_total_anon" ON motoristas FOR ALL TO anon USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS "acesso_total_anon" ON ajudantes;
CREATE POLICY "acesso_total_anon" ON ajudantes FOR ALL TO anon USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS "acesso_total_anon" ON colaboradores_cd;
CREATE POLICY "acesso_total_anon" ON colaboradores_cd FOR ALL TO anon USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS "acesso_total_anon" ON veiculos;
CREATE POLICY "acesso_total_anon" ON veiculos FOR ALL TO anon USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS "acesso_total_anon" ON clientes;
CREATE POLICY "acesso_total_anon" ON clientes FOR ALL TO anon USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS "acesso_total_anon" ON produtos;
CREATE POLICY "acesso_total_anon" ON produtos FOR ALL TO anon USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS "acesso_total_anon" ON cargas;
CREATE POLICY "acesso_total_anon" ON cargas FOR ALL TO anon USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS "acesso_total_anon" ON ocorrencias_devolucao;
CREATE POLICY "acesso_total_anon" ON ocorrencias_devolucao FOR ALL TO anon USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS "acesso_total_anon" ON itens_devolucao;
CREATE POLICY "acesso_total_anon" ON itens_devolucao FOR ALL TO anon USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS "acesso_total_anon" ON relatorios_divergencia;
CREATE POLICY "acesso_total_anon" ON relatorios_divergencia FOR ALL TO anon USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS "acesso_total_anon" ON itens_relatorio_divergencia;
CREATE POLICY "acesso_total_anon" ON itens_relatorio_divergencia FOR ALL TO anon USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS "acesso_total_anon" ON ocorrencias_rota;
CREATE POLICY "acesso_total_anon" ON ocorrencias_rota FOR ALL TO anon USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS "acesso_total_anon" ON trocas_veiculos;
CREATE POLICY "acesso_total_anon" ON trocas_veiculos FOR ALL TO anon USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS "acesso_total_anon" ON auditoria_produtividade;
CREATE POLICY "acesso_total_anon" ON auditoria_produtividade FOR ALL TO anon USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS "acesso_total_anon" ON audit_logs;
CREATE POLICY "acesso_total_anon" ON audit_logs FOR ALL TO anon USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS "acesso_total_anon" ON registro_versoes;
CREATE POLICY "acesso_total_anon" ON registro_versoes FOR ALL TO anon USING (true) WITH CHECK (true);

-- =============================================================================
-- As VIEWS otimizadas para Power BI ficam em database/schema_views.sql
-- (Query 2) — rodar SEMPRE depois deste arquivo (Query 1) ter concluído
-- com sucesso, nunca junto na mesma query. Ver o cabeçalho daquele
-- arquivo para o motivo.
-- =============================================================================

-- =============================================================================
-- 11. MÓDULO: GESTÃO DE RETENÇÃO DE FROTA (v6.1.0)
-- Rastreia veículos parados (RETIDO) e liberados (LIBERADO) com protocolo
-- sequencial, FK para veiculos, soft delete e timestamps completos.
-- =============================================================================

CREATE TABLE IF NOT EXISTS retencoes_frota (
    id BIGINT PRIMARY KEY,                          -- Date.now() do cliente
    numero_retencao VARCHAR(20) UNIQUE NOT NULL,    -- Ex.: RET-2026-001
    veiculo_id INT REFERENCES veiculos(id) ON DELETE SET NULL,
    placa VARCHAR(10) NOT NULL,                     -- Desnormalizado (consulta rápida)
    tipo_veiculo VARCHAR(50) NOT NULL,              -- TOCO, TRUCK, VAN, etc.
    data_parada DATE NOT NULL,                      -- Data que o veículo foi parado
    motivo TEXT NOT NULL,                           -- Descrição livre do motivo
    tipo_os VARCHAR(20) NOT NULL DEFAULT 'CORRETIVA'
        CHECK (tipo_os IN ('SINISTRO', 'CORRETIVA', 'PREVENTIVA')),
    local VARCHAR(150),                             -- Oficina / local de parada
    data_previsao DATE,                             -- Previsão de liberação
    data_liberacao DATE,                            -- Data efetiva de liberação
    status VARCHAR(10) NOT NULL DEFAULT 'RETIDO'
        CHECK (status IN ('RETIDO', 'LIBERADO')),
    criado_por VARCHAR(120),                        -- currentUser.nome
    criado_em TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    is_deleted BOOLEAN DEFAULT FALSE,
    deleted_at TIMESTAMP NULL,
    deleted_by_nome VARCHAR(120) NULL
);

-- Índices de performance
CREATE INDEX IF NOT EXISTS idx_ret_frota_status
    ON retencoes_frota(status);
CREATE INDEX IF NOT EXISTS idx_ret_frota_veiculo
    ON retencoes_frota(veiculo_id);
CREATE INDEX IF NOT EXISTS idx_ret_frota_data_parada
    ON retencoes_frota(data_parada);
CREATE INDEX IF NOT EXISTS idx_ret_frota_is_deleted
    ON retencoes_frota(is_deleted) WHERE is_deleted = FALSE;

-- RLS
ALTER TABLE retencoes_frota ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "acesso_total_anon" ON retencoes_frota;
CREATE POLICY "acesso_total_anon" ON retencoes_frota
    FOR ALL TO anon USING (true) WITH CHECK (true);

-- =============================================================================
-- 13. CORREÇÃO DE TIPO (continuação): retencoes_frota.veiculo_id só existe
-- depois da tabela ser criada acima. A VIEW 6 (disponibilidade_frota) que
-- usava essa coluna agora está em database/schema_views.sql (Query 2),
-- pelo mesmo motivo do bloco 10.5.
ALTER TABLE retencoes_frota ALTER COLUMN veiculo_id TYPE BIGINT;

-- =============================================================================
-- 12. MÓDULO: CONTROLE DE REENTREGAS DE ROTA
-- =============================================================================

CREATE TABLE IF NOT EXISTS reentregas_rota (
    id BIGINT PRIMARY KEY,
    data DATE NOT NULL,
    carga_numero VARCHAR(50) NOT NULL,
    rota_nome VARCHAR(100) NOT NULL,
    motorista_nome VARCHAR(120) NOT NULL,
    entregas_saiu INT DEFAULT 0,
    entregas_feitas INT DEFAULT 0,
    entregas_reentrega INT DEFAULT 0,
    motivo TEXT NOT NULL,
    placa VARCHAR(20) NOT NULL,
    novo_motorista VARCHAR(120),
    -- Custodia da reentrega (v5.0.0 / migrations 28 e 31):
    --     PENDENTE -> RECEBIDO_CD -> DESPACHADO -> REALIZADA
    --                                           -> CANCELADA
    status VARCHAR(20) NOT NULL DEFAULT 'PENDENTE'
      CHECK (status IN ('PENDENTE', 'RECEBIDO_CD', 'DESPACHADO', 'REALIZADA', 'CANCELADA')),

    -- Recepcao fisica no CD. qtd_recebida_cd e separada de entregas_reentrega
    -- de proposito: a segunda e o que o motorista DECLAROU na rota, a primeira
    -- e o que o CD CONTOU na doca. E onde as duas divergem que a etapa se paga.
    recebido_cd_em         TIMESTAMP,
    recebido_cd_por        VARCHAR(120),
    qtd_recebida_cd        INT,
    condicao_recebimento   VARCHAR(20) CHECK (condicao_recebimento IS NULL OR condicao_recebimento IN ('OK','AVARIA','FALTA_PARCIAL')),
    observacao_recebimento TEXT,
    local_armazenagem      VARCHAR(60),
    fotos_recebimento      JSONB DEFAULT '[]'::jsonb,

    -- Despacho para o veiculo (o mesmo ou outro). Quem leva continua sendo
    -- novo_motorista, que ja existia -- dois campos com o mesmo significado
    -- sempre acabam divergindo.
    despachado_em          TIMESTAMP,
    despachado_por         VARCHAR(120),
    despacho_placa         VARCHAR(20),
    despacho_carga_numero  VARCHAR(50),
    qtd_despachada         INT,
    fotos_despacho         JSONB DEFAULT '[]'::jsonb,

    -- Fecho e cancelamento
    realizada_em           TIMESTAMP,
    cancelada_em           TIMESTAMP,
    cancelada_por          VARCHAR(120),
    motivo_cancelamento    TEXT,
    devolucao_gerada_id    BIGINT,

    -- Foto obrigatoria nas duas etapas do CD. A trava fica aqui E na tela: so
    -- na tela, a garantia dependeria de a tela se comportar.
    CONSTRAINT reentregas_foto_recebimento_check CHECK (
      status NOT IN ('RECEBIDO_CD','DESPACHADO')
      OR (fotos_recebimento IS NOT NULL AND jsonb_array_length(fotos_recebimento) > 0)),
    CONSTRAINT reentregas_foto_despacho_check CHECK (
      status <> 'DESPACHADO'
      OR (fotos_despacho IS NOT NULL AND jsonb_array_length(fotos_despacho) > 0)),

    criado_por VARCHAR(120),
    criado_em TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    is_deleted BOOLEAN DEFAULT FALSE,
    deleted_at TIMESTAMP NULL,
    deleted_by_nome VARCHAR(120) NULL
);

-- Índices de performance (restaurados em 19/08/2026 — tinham sido
-- removidos sem querer numa edição anterior deste arquivo)
CREATE INDEX IF NOT EXISTS idx_reentregas_status ON reentregas_rota(status);
CREATE INDEX IF NOT EXISTS idx_reentregas_data ON reentregas_rota(data);
CREATE INDEX IF NOT EXISTS idx_reentregas_carga ON reentregas_rota(carga_numero);
CREATE INDEX IF NOT EXISTS idx_reentregas_is_deleted ON reentregas_rota(is_deleted) WHERE is_deleted = FALSE;

-- RLS (idem — restaurado)
ALTER TABLE reentregas_rota ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "acesso_total_anon" ON reentregas_rota;
CREATE POLICY "acesso_total_anon" ON reentregas_rota
    FOR ALL TO anon USING (true) WITH CHECK (true);

-- =============================================================================
-- 14. COLEÇÕES SEM TABELA (achado em 19/08/2026) — Resumo Diário CD,
-- Controle de Viagens, Ocorrências de Viagem e os 3 blocos do
-- Acompanhamento de Funcionário/Dossiê Motorista (Medidas Disciplinares,
-- Orientação e Feedback, Atestados, Ausências) nunca tiveram tabela no
-- Supabase — ficavam presas em localStorage, sem sincronizar entre contas
-- nem sobreviver a uma limpeza de cache. controle_viagens e
-- ocorrencias_viagens têm registros simples (mesmo padrão de
-- trocas_veiculos/retencoes_frota). resumo_diario_cd é diferente: cada
-- registro (por data+turno) contém listas aninhadas (ocorrências,
-- faltas, movimentação) — em vez de forçar uma normalização relacional
-- grande e arriscada a poucos dias do go-live, essas listas viram
-- colunas JSONB, espelhando exatamente a estrutura que o app já usa
-- localmente. Isso resolve o problema real de hoje (dado preso no
-- aparelho) sem reescrever a lógica de leitura/escrita do módulo. A
-- quebra em tabelas relacionais completas (para Power BI DirectQuery)
-- continua sendo um projeto à parte, do tamanho que já foi sinalizado.

CREATE TABLE IF NOT EXISTS controle_viagens (
    id BIGINT PRIMARY KEY,                          -- Date.now() do cliente
    carga VARCHAR(60),
    rota VARCHAR(150),
    placa VARCHAR(10),
    motorista VARCHAR(120),
    ajudante VARCHAR(120),
    setor VARCHAR(30) DEFAULT 'FRIO',
    data_saida VARCHAR(20),
    hora_saida VARCHAR(10),
    data_entrega VARCHAR(20),
    hora_entrega VARCHAR(10),
    data_retorno VARCHAR(20),
    hora_retorno VARCHAR(10),
    status_viagem VARCHAR(40),
    fusion VARCHAR(20),
    checklist_saida VARCHAR(20),
    checklist_chegada VARCHAR(20),
    observacao TEXT,
    is_deleted BOOLEAN DEFAULT FALSE,
    deleted_at TIMESTAMP NULL,
    deleted_by_nome VARCHAR(120) NULL,
    criado_em TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
ALTER TABLE controle_viagens ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "acesso_total_anon" ON controle_viagens;
CREATE POLICY "acesso_total_anon" ON controle_viagens FOR ALL TO anon USING (true) WITH CHECK (true);

CREATE TABLE IF NOT EXISTS ocorrencias_viagens (
    id BIGINT PRIMARY KEY,
    data VARCHAR(20),
    carga VARCHAR(60),
    rota VARCHAR(150),
    placa VARCHAR(10),
    funcionario VARCHAR(120),
    funcao VARCHAR(40) DEFAULT 'MOTORISTA',
    motivo VARCHAR(60) DEFAULT 'OUTRO',
    causa TEXT,
    ocorrencia TEXT,
    acao TEXT,
    is_deleted BOOLEAN DEFAULT FALSE,
    deleted_at TIMESTAMP NULL,
    deleted_by_nome VARCHAR(120) NULL,
    criado_em TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
ALTER TABLE ocorrencias_viagens ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "acesso_total_anon" ON ocorrencias_viagens;
CREATE POLICY "acesso_total_anon" ON ocorrencias_viagens FOR ALL TO anon USING (true) WITH CHECK (true);

CREATE TABLE IF NOT EXISTS resumo_diario_cd (
    id BIGINT PRIMARY KEY,
    data DATE NOT NULL,
    turno VARCHAR(40) NOT NULL,
    gestor VARCHAR(120),
    movimentacao JSONB,
    faltas_condutas JSONB,
    ocorrencias JSONB,
    ocorrencias_colaboradores JSONB,
    cortes JSONB,
    is_deleted BOOLEAN DEFAULT FALSE,
    UNIQUE(data, turno)
);
ALTER TABLE resumo_diario_cd ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "acesso_total_anon" ON resumo_diario_cd;
CREATE POLICY "acesso_total_anon" ON resumo_diario_cd FOR ALL TO anon USING (true) WITH CHECK (true);

CREATE TABLE IF NOT EXISTS medidas_disciplinares (
    id VARCHAR(60) PRIMARY KEY,                     -- ex: medida_1755600000000_ab12cd
    numero_medida VARCHAR(20),
    tipo VARCHAR(30),                               -- ADVERTENCIA | SUSPENSAO (Orientação Verbal não entra mais aqui)
    colaborador_tipo VARCHAR(20),
    colaborador_id BIGINT,
    colaborador_nome VARCHAR(120),
    chapa VARCHAR(20),
    cpf VARCHAR(14),
    funcao VARCHAR(80),
    secao VARCHAR(100),
    alineas_clt TEXT,
    dias_suspensao INT,
    motivo TEXT,
    gestor VARCHAR(120),
    data_ocorrencia DATE,
    criado_por VARCHAR(120),
    criado_em TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    is_deleted BOOLEAN DEFAULT FALSE,
    deleted_at TIMESTAMP NULL
);
ALTER TABLE medidas_disciplinares ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "acesso_total_anon" ON medidas_disciplinares;
CREATE POLICY "acesso_total_anon" ON medidas_disciplinares FOR ALL TO anon USING (true) WITH CHECK (true);

CREATE TABLE IF NOT EXISTS orientacoes_feedback (
    id VARCHAR(60) PRIMARY KEY,
    colaborador_tipo VARCHAR(20),
    colaborador_id BIGINT,
    colaborador_nome VARCHAR(120),
    data DATE,
    ocorrencia TEXT,
    acao TEXT,
    criado_por VARCHAR(120),
    criado_em TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    is_deleted BOOLEAN DEFAULT FALSE,
    deleted_at TIMESTAMP NULL
);
ALTER TABLE orientacoes_feedback ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "acesso_total_anon" ON orientacoes_feedback;
CREATE POLICY "acesso_total_anon" ON orientacoes_feedback FOR ALL TO anon USING (true) WITH CHECK (true);

CREATE TABLE IF NOT EXISTS atestados_medicos (
    id VARCHAR(60) PRIMARY KEY,
    colaborador_tipo VARCHAR(20),
    colaborador_id BIGINT,
    colaborador_nome VARCHAR(120),
    data DATE,
    tipo_afastamento VARCHAR(20),
    motivo TEXT,
    cid VARCHAR(20),
    medico VARCHAR(120),
    crm_cro VARCHAR(30),
    criado_por VARCHAR(120),
    criado_em TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    is_deleted BOOLEAN DEFAULT FALSE,
    deleted_at TIMESTAMP NULL
);
ALTER TABLE atestados_medicos ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "acesso_total_anon" ON atestados_medicos;
CREATE POLICY "acesso_total_anon" ON atestados_medicos FOR ALL TO anon USING (true) WITH CHECK (true);

CREATE TABLE IF NOT EXISTS ausencias_registros (
    id VARCHAR(60) PRIMARY KEY,
    colaborador_tipo VARCHAR(20),
    colaborador_id BIGINT,
    colaborador_nome VARCHAR(120),
    data DATE,
    motivo TEXT,
    criado_por VARCHAR(120),
    criado_em TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    is_deleted BOOLEAN DEFAULT FALSE,
    deleted_at TIMESTAMP NULL
);
ALTER TABLE ausencias_registros ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "acesso_total_anon" ON ausencias_registros;
CREATE POLICY "acesso_total_anon" ON ausencias_registros FOR ALL TO anon USING (true) WITH CHECK (true);

-- =============================================================================
-- 16. COLUNAS QUE FALTAVAM (achado em 20/08/2026, auditoria externa) — mesmo
-- padrão de sempre: js/store.js grava campos que nunca tiveram coluna no
-- Supabase, então cloudStore.upsert() rejeita o registro inteiro
-- (PGRST204) e a tabela inteira nunca sincroniza. colaboradores_cd tinha
-- o mesmo bug de motoristas (data_admissao/data_desligamento).
-- auditoria_produtividade tem DOIS formatos de registro diferentes vindos
-- de dois pontos do código (updateAcaoGestor identifica por nome/protocolo;
-- updateInvestigacao identifica por usuario_id/setor_id) — usuario_id e
-- setor_id viram opcionais para caber os dois. relatorios_divergencia
-- nunca teve NENHUMA das colunas que o app realmente grava (gerarRelatorioDivergencia
-- em app.js usa nomes completamente diferentes dos que já existiam aqui:
-- protocolo/motorista/veiculo/rota/cliente em vez de
-- numero_protocolo/motorista_nome/veiculo_placa/rota_nome/cliente_nome, e
-- itens_divergentes/valor_total_divergencia/tipo_erro não existiam de
-- forma alguma). As colunas antigas ficam como legado, sem uso.
ALTER TABLE colaboradores_cd ADD COLUMN IF NOT EXISTS data_admissao DATE;
ALTER TABLE colaboradores_cd ADD COLUMN IF NOT EXISTS data_desligamento DATE;

ALTER TABLE auditoria_produtividade ALTER COLUMN usuario_id DROP NOT NULL;
ALTER TABLE auditoria_produtividade ALTER COLUMN setor_id DROP NOT NULL;
ALTER TABLE auditoria_produtividade ALTER COLUMN tipo_falha DROP NOT NULL;
ALTER TABLE auditoria_produtividade ADD COLUMN IF NOT EXISTS protocolo VARCHAR(30);
ALTER TABLE auditoria_produtividade ADD COLUMN IF NOT EXISTS separador_nome VARCHAR(120);
ALTER TABLE auditoria_produtividade ADD COLUMN IF NOT EXISTS conferente_nome VARCHAR(120);
ALTER TABLE auditoria_produtividade ADD COLUMN IF NOT EXISTS tipo_erro VARCHAR(80);
ALTER TABLE auditoria_produtividade ADD COLUMN IF NOT EXISTS motivo_causa_raiz VARCHAR(150);
ALTER TABLE auditoria_produtividade ADD COLUMN IF NOT EXISTS acao_gestor TEXT;
ALTER TABLE auditoria_produtividade ADD COLUMN IF NOT EXISTS gestor_id BIGINT;

ALTER TABLE relatorios_divergencia ADD COLUMN IF NOT EXISTS ocorrencia_id BIGINT REFERENCES ocorrencias_devolucao(id) ON DELETE CASCADE;
ALTER TABLE relatorios_divergencia ADD COLUMN IF NOT EXISTS protocolo VARCHAR(30);
ALTER TABLE relatorios_divergencia ADD COLUMN IF NOT EXISTS motorista VARCHAR(120);
ALTER TABLE relatorios_divergencia ADD COLUMN IF NOT EXISTS ajudante VARCHAR(120);
ALTER TABLE relatorios_divergencia ADD COLUMN IF NOT EXISTS veiculo VARCHAR(20);
ALTER TABLE relatorios_divergencia ADD COLUMN IF NOT EXISTS rota VARCHAR(100);
ALTER TABLE relatorios_divergencia ADD COLUMN IF NOT EXISTS cliente VARCHAR(150);
ALTER TABLE relatorios_divergencia ADD COLUMN IF NOT EXISTS tipo_erro VARCHAR(80);
ALTER TABLE relatorios_divergencia ADD COLUMN IF NOT EXISTS itens_divergentes JSONB;
ALTER TABLE relatorios_divergencia ADD COLUMN IF NOT EXISTS valor_total_divergencia DECIMAL(12,2);

-- =============================================================================
-- 17. MÓDULO: INVESTIGAÇÃO DE SINISTROS (achado em 20/08/2026, auditoria
-- externa) — nunca teve tabela no Supabase; store.js/app.js já
-- implementam um fluxo completo de 5 etapas (Motorista, Manutenção,
-- Operações, Jurídico [condicional], Diretoria) com fotos por etapa, só
-- que 100% preso em localStorage. id é string (gerado como
-- "sinistro_<timestamp>_<random>" em store.js), não numérico — mesmo
-- padrão de medidas_disciplinares/orientacoes_feedback acima. Campos de
-- foto (arrays no app) viram JSONB, mesmo padrão de resumo_diario_cd.
-- =============================================================================
CREATE TABLE IF NOT EXISTS sinistros (
    id VARCHAR(80) PRIMARY KEY,
    numero_sinistro VARCHAR(20) UNIQUE,
    ocorrencia_rota_id BIGINT REFERENCES ocorrencias_rota(id) ON DELETE SET NULL,
    carga VARCHAR(60),
    placa VARCHAR(10),
    veiculo_id BIGINT REFERENCES veiculos(id) ON DELETE SET NULL,
    motorista_nome VARCHAR(120),
    motorista_id BIGINT REFERENCES motoristas(id) ON DELETE SET NULL,
    data_acidente DATE,
    local_acidente VARCHAR(200),

    etapa_motorista_completa BOOLEAN DEFAULT FALSE,
    etapa_manutencao_completa BOOLEAN DEFAULT FALSE,
    etapa_operacoes_completa BOOLEAN DEFAULT FALSE,
    juridico_necessario BOOLEAN DEFAULT FALSE,
    etapa_juridico_completa BOOLEAN DEFAULT FALSE,
    etapa_diretoria_completa BOOLEAN DEFAULT FALSE,
    status_geral VARCHAR(20) DEFAULT 'PENDENTE',

    -- Etapa 1: Motorista
    motorista_cpf VARCHAR(14),
    motorista_cnh VARCHAR(20),
    motorista_cnh_validade DATE,
    tipo_veiculo_jr_motorista VARCHAR(50),
    veiculo_terceiro_condutor_nome VARCHAR(120),
    veiculo_terceiro_placa VARCHAR(10),
    veiculo_terceiro_renavam VARCHAR(20),
    veiculo_terceiro_marca VARCHAR(80),
    relato_motorista TEXT,
    havia_sinalizacao_motorista BOOLEAN,
    sinalizacao_relato_motorista TEXT,
    motorista_assinatura_nome VARCHAR(120),
    motorista_assinatura_data DATE,
    fotos_danos_jr_motorista JSONB,
    fotos_danos_terceiro_motorista JSONB,

    -- Etapa 2: Manutenção
    relato_manutencao TEXT,
    havia_sinalizacao_manutencao BOOLEAN,
    sinalizacao_relato_manutencao TEXT,
    tem_testemunhas BOOLEAN,
    testemunha_nome_contato VARCHAR(150),
    parecer_manutencao TEXT,
    manutencao_gestor_nome VARCHAR(120),
    manutencao_data DATE,
    fotos_danos_jr_manutencao JSONB,
    fotos_danos_terceiro_manutencao JSONB,
    orcamentos_anexos JSONB,
    fotos_acidente_bo JSONB,

    -- Etapa 3: Operações
    parecer_operacoes TEXT,
    operacoes_gestor_nome VARCHAR(120),
    operacoes_data DATE,

    -- Etapa 4: Jurídico (condicional)
    parecer_juridico TEXT,
    juridico_nome VARCHAR(120),
    juridico_data DATE,

    -- Etapa 5: Diretoria
    responsabilidade_motorista BOOLEAN,
    desconto_motorista BOOLEAN,
    valor_desconto DECIMAL(10,2),
    numero_parcelas INT,
    diretoria_nome VARCHAR(120),
    diretoria_data DATE,

    criado_por VARCHAR(120),
    criado_em TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    atualizado_em TIMESTAMP,
    is_deleted BOOLEAN DEFAULT FALSE,
    deleted_at TIMESTAMP NULL
);
ALTER TABLE sinistros ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "acesso_total_anon" ON sinistros;
CREATE POLICY "acesso_total_anon" ON sinistros FOR ALL TO anon USING (true) WITH CHECK (true);

-- =============================================================================
-- 18. MÓDULO: ITENS AVULSOS DE DESTINAÇÃO (achado em 20/08/2026, auditoria
-- externa) — item avariado/sobra identificado direto no CD, sem chamado
-- formal de devolução associado. id é string (formato "avulso_<timestamp>_<random>").
-- =============================================================================
CREATE TABLE IF NOT EXISTS itens_avulsos_destinacao (
    id VARCHAR(60) PRIMARY KEY,
    produto_codigo VARCHAR(40),
    produto_descricao VARCHAR(200),
    quantidade DECIMAL(10,2),
    destino_item VARCHAR(50),
    data_validade DATE,
    observacao TEXT,
    status_negociacao VARCHAR(30),
    motivo_avulso VARCHAR(150),
    divisoes_destino JSONB,
    criado_por VARCHAR(120),
    criado_em TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    is_deleted BOOLEAN DEFAULT FALSE,
    deleted_at TIMESTAMP NULL
);
ALTER TABLE itens_avulsos_destinacao ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "acesso_total_anon" ON itens_avulsos_destinacao;
CREATE POLICY "acesso_total_anon" ON itens_avulsos_destinacao FOR ALL TO anon USING (true) WITH CHECK (true);

-- =============================================================================
-- 19. COLUNAS QUE FALTAVAM (achado em 21/08/2026, auditoria sistemática de
-- todo campo gravado pelo app x toda coluna existente no banco, feita
-- depois de confirmar por teste direto que uma Devolução SAC nunca
-- sincronizava). Mesmo padrão de sempre (achados 16/17 acima): o app grava
-- um campo que nunca teve coluna correspondente aqui, o PostgREST rejeita
-- o envio INTEIRO daquela tabela (PGRST204) e ninguém percebe porque a
-- gravação local funciona normalmente.
--
-- ocorrencias_rota: addOcorrenciaRota() em store.js grava 7 campos
-- desnormalizados (usados pelas telas de lista/filtro sem precisar de
-- join) que nunca tiveram coluna — ou seja, o módulo inteiro de "Frota /
-- Chamado em Rota" nunca conseguiu sincronizar um único registro.
ALTER TABLE ocorrencias_rota ADD COLUMN IF NOT EXISTS carga_numero VARCHAR(40);
ALTER TABLE ocorrencias_rota ADD COLUMN IF NOT EXISTS veiculo_placa VARCHAR(20);
ALTER TABLE ocorrencias_rota ADD COLUMN IF NOT EXISTS motorista_nome VARCHAR(120);
ALTER TABLE ocorrencias_rota ADD COLUMN IF NOT EXISTS rota_nome VARCHAR(100);
ALTER TABLE ocorrencias_rota ADD COLUMN IF NOT EXISTS motivo_resumido VARCHAR(100);
ALTER TABLE ocorrencias_rota ADD COLUMN IF NOT EXISTS status_veiculo VARCHAR(50);
ALTER TABLE ocorrencias_rota ADD COLUMN IF NOT EXISTS criado_por VARCHAR(120);

-- retencoes_frota: addRetencaoFrota() grava numero_os/link_os (o Nº da OS é
-- derivado automaticamente do link informado) — nenhuma das duas colunas
-- existia.
ALTER TABLE retencoes_frota ADD COLUMN IF NOT EXISTS numero_os VARCHAR(60);
ALTER TABLE retencoes_frota ADD COLUMN IF NOT EXISTS link_os TEXT;

-- resumo_diario_cd: saveResumoDiarioCD() grava atualizado_em em todo save,
-- coluna nunca existiu.
ALTER TABLE resumo_diario_cd ADD COLUMN IF NOT EXISTS atualizado_em TIMESTAMP;

-- auditoria_produtividade: updateAcaoGestor() em store.js já foi corrigido
-- para gravar separador_nome/conferente_nome (colunas que já existem desde
-- o achado 16) em vez de separador/conferente (que nunca existiram) — nada
-- a alterar aqui, registrado só para o histórico ficar completo.


-- =============================================================================
-- 22. CORRECAO DA SINCRONIZACAO (21/08/2026) - ver database/migration_22_fix_sync.sql
-- Incorporado aqui para que uma instalacao NOVA ja nasca correta.
-- =============================================================================

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


-- Recarrega o cache de schema do PostgREST - sem isso, colunas recem
-- criadas continuam devolvendo PGRST204 por alguns minutos.
NOTIFY pgrst, 'reload schema';

-- =============================================================================
-- 23. CHECKS PERMISSIVOS + SYNC_CONTROL (21/08/2026)
-- ver database/migration_23_checks_e_reset.sql
-- =============================================================================


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


NOTIFY pgrst, 'reload schema';

-- =============================================================================
-- 24. UNIQUE PARCIAL - branco nao colide (22/08/2026)
-- ver database/migration_24_unique_parcial.sql
-- =============================================================================
-- Rode no SQL Editor do Supabase. E idempotente.
-- =============================================================================


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

-- =============================================================================
-- 25/26. CADASTROS QUE NASCERAM NAS MIGRACOES (23/08/2026)
--
-- ATENCAO PARA INSTALACAO NOVA: as tabelas das migracoes 25 (rotas,
-- motivos_devolucao) e 26 (departamentos) NAO estao replicadas aqui. Ate a
-- 24 o schema vinha sendo mantido em dia; da 25 em diante nao foi.
--
-- Para uma instalacao nova nascer completa, rode NESTA ORDEM:
--   1. este schema.sql
--   2. database/migration_25_cadastros_mestres.sql
--   3. database/migration_26_departamentos.sql
--
-- As duas sao idempotentes: rodar em banco que ja as tem nao quebra nada.
-- =============================================================================
