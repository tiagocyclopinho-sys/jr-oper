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
    ativo BOOLEAN DEFAULT TRUE
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
    gerado_em TIMESTAMP DEFAULT CURRENT_TIMESTAMP
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
    usuario_id INT NOT NULL REFERENCES usuarios(id),
    setor_id INT NOT NULL REFERENCES setores(id),
    ocorrencia_devolucao_id INT REFERENCES ocorrencias_devolucao(id),
    ocorrencia_rota_id INT REFERENCES ocorrencias_rota(id),
    tipo_falha VARCHAR(80) NOT NULL,
    valor_prejuizo DECIMAL(10,2) DEFAULT 0.00,
    pontos_desconto INT DEFAULT 0,
    observacoes TEXT,
    registrado_em TIMESTAMP DEFAULT CURRENT_TIMESTAMP
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
-- VIEWS OTIMIZADAS PARA POWER BI
-- =============================================================================

-- VIEW 1: PRODUTIVIDADE DA EQUIPE
DROP VIEW IF EXISTS vw_bi_produtividade_equipe CASCADE;
CREATE OR REPLACE VIEW vw_bi_produtividade_equipe AS
SELECT 
    u.id AS usuario_id,
    u.nome AS colaborador_nome,
    u.cargo,
    s.nome AS setor_nome,
    COUNT(DISTINCT od.id) AS total_ocorrencias_vinculadas,
    SUM(od.valor_reclamado) AS total_valor_reclamado_r$,
    COUNT(CASE WHEN ap.tipo_falha LIKE '%separacao%' OR ap.tipo_falha LIKE '%FALTA%' THEN 1 END) AS qtd_erros_separacao,
    COUNT(CASE WHEN ap.tipo_falha LIKE '%conferencia%' THEN 1 END) AS qtd_erros_conferencia,
    COALESCE(SUM(ap.valor_prejuizo), 0.00) AS total_prejuizo_financeiro_r$,
    COALESCE(SUM(ap.pontos_desconto), 0) AS total_pontos_descontados
FROM usuarios u
LEFT JOIN setores s ON u.setor_id = s.id
LEFT JOIN ocorrencias_devolucao od ON u.id = od.separador_id OR u.id = od.conferente_id
LEFT JOIN auditoria_produtividade ap ON u.id = ap.usuario_id
GROUP BY u.id, u.nome, u.cargo, s.nome;

-- VIEW 2: ANÁLISE DE CAUSA RAIZ
DROP VIEW IF EXISTS vw_bi_devolucoes_causa_raiz CASCADE;
CREATE OR REPLACE VIEW vw_bi_devolucoes_causa_raiz AS
SELECT 
    od.motivo_reclamado AS motivo_inicial_cliente,
    COALESCE(od.motivo_real_causa_raiz, 'Pendente de Investigação') AS causa_raiz_real,
    s.nome AS setor_causador,
    COUNT(od.id) AS quantidade_ocorrencias,
    SUM(od.valor_reclamado) AS valor_total_devolvido_r$,
    COUNT(CASE WHEN od.cliente_emite_nf = TRUE THEN 1 END) AS qtd_cliente_emitiu_nf,
    COUNT(CASE WHEN od.forma_acerto = 'ABATIMENTO' THEN 1 END) AS qtd_acerto_abatimento,
    COUNT(CASE WHEN od.forma_acerto = 'JR_PAGA_DIFERENCA' THEN 1 END) AS qtd_acerto_jr_paga
FROM ocorrencias_devolucao od
LEFT JOIN setores s ON od.setor_encaminhado_id = s.id
GROUP BY od.motivo_reclamado, od.motivo_real_causa_raiz, s.nome;

-- VIEW 3: FROTA & VEÍCULOS PARADOS
DROP VIEW IF EXISTS vw_bi_frota_veiculos_parados CASCADE;
CREATE OR REPLACE VIEW vw_bi_frota_veiculos_parados AS
SELECT 
    v.placa,
    v.modelo,
    m.nome AS motorista_nome,
    c.numero_carga,
    c.rota,
    o.tipo_ocorrencia,
    o.localizacao,
    o.descricao,
    o.veiculo_parado,
    o.status AS status_manutencao,
    o.status_chamado,
    o.retorno_manutencao_descricao,
    o.retorno_manutencao_data,
    o.retorno_manutencao_responsavel,
    o.guincho_acionado,
    COALESCE(o.custo_socorro, 0.00) AS custo_socorro_r$,
    o.criado_em AS data_abertura,
    o.resolvido_em AS data_resolucao,
    ROUND(EXTRACT(EPOCH FROM (COALESCE(o.resolvido_em, CURRENT_TIMESTAMP) - o.criado_em))/3600, 2) AS horas_parado
FROM ocorrencias_rota o
JOIN veiculos v ON o.veiculo_id = v.id
JOIN motoristas m ON o.motorista_id = m.id
JOIN cargas c ON o.carga_id = c.id;

-- VIEW 4: CONTROLE CD - PENDÊNCIAS
DROP VIEW IF EXISTS vw_bi_controle_cd_pendencias CASCADE;
CREATE OR REPLACE VIEW vw_bi_controle_cd_pendencias AS
SELECT 
    od.numero_protocolo,
    c.numero_carga,
    c.rota,
    cli.razao_social AS cliente_nome,
    p.codigo_produto,
    p.descricao AS produto_descricao,
    id.quantidade,
    id.valor_total AS valor_item_r$,
    od.status_fechamento,
    od.destino_cd,
    od.criado_em AS data_chamado
FROM ocorrencias_devolucao od
JOIN cargas c ON od.carga_id = c.id
JOIN clientes cli ON od.cliente_id = cli.id
JOIN itens_devolucao id ON od.id = id.ocorrencia_devolucao_id
JOIN produtos p ON id.produto_id = p.id
WHERE od.status_fechamento = 'PENDENTE_FISICO';

-- VIEW 5: TROCAS DE VEÍCULOS
DROP VIEW IF EXISTS vw_bi_trocas_veiculos CASCADE;
CREATE OR REPLACE VIEW vw_bi_trocas_veiculos AS
SELECT 
    id, data, veiculo_escalado, veiculo_trocado, motivo_resumido,
    motivo_outro, detalhamento, autorizado_por, criado_em
FROM trocas_veiculos;

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
-- VIEW 6: DISPONIBILIDADE DA FROTA (Power BI)
-- Cruza veículos cadastrados × retenções ativas para calcular status atual,
-- dias parado e dias de atraso em relação à previsão.
-- =============================================================================
DROP VIEW IF EXISTS vw_bi_disponibilidade_frota CASCADE;
CREATE OR REPLACE VIEW vw_bi_disponibilidade_frota AS
SELECT
    v.id                                          AS veiculo_id,
    v.placa,
    v.modelo,
    v.tipo                                        AS tipo_veiculo,
    v.capacidade_kg,
    v.ativo                                       AS veiculo_ativo,
    COALESCE(r.status, 'DISPONÍVEL')              AS status_frota,
    r.numero_retencao,
    r.motivo,
    r.tipo_os,
    r.local                                       AS local_parada,
    r.data_parada,
    r.data_previsao,
    r.data_liberacao,
    r.criado_por                                  AS registrado_por,
    -- Dias corridos parado (aberto) ou tempo total de parada (liberado)
    CASE
        WHEN r.status = 'RETIDO' THEN
            CURRENT_DATE - r.data_parada
        WHEN r.status = 'LIBERADO' AND r.data_liberacao IS NOT NULL THEN
            r.data_liberacao - r.data_parada
        ELSE NULL
    END                                           AS dias_parado,
    -- Dias de atraso em relação à previsão (apenas RETIDO e atrasado)
    CASE
        WHEN r.status = 'RETIDO'
             AND r.data_previsao IS NOT NULL
             AND CURRENT_DATE > r.data_previsao
        THEN CURRENT_DATE - r.data_previsao
        ELSE 0
    END                                           AS dias_atraso_previsao
FROM veiculos v
LEFT JOIN retencoes_frota r
    ON r.veiculo_id = v.id
    AND r.is_deleted = FALSE
    AND r.status = 'RETIDO'   -- apenas retenção aberta por veículo
WHERE v.is_deleted = FALSE;

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
    status VARCHAR(20) NOT NULL DEFAULT 'PENDENTE' CHECK (status IN ('PENDENTE', 'REALIZADA')),
    criado_por VARCHAR(120),
    criado_em TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    is_deleted BOOLEAN DEFAULT FALSE,
    deleted_at TIMESTAMP NULL,
    deleted_by_nome VARCHAR(120) NULL
);

-- Índices de performance
CREATE INDEX IF NOT EXISTS idx_reentregas_status ON reentregas_rota(status);
CREATE INDEX IF NOT EXISTS idx_reentregas_data ON reentregas_rota(data);
CREATE INDEX IF NOT EXISTS idx_reentregas_carga ON reentregas_rota(carga_numero);
CREATE INDEX IF NOT EXISTS idx_reentregas_is_deleted ON reentregas_rota(is_deleted) WHERE is_deleted = FALSE;

-- RLS
ALTER TABLE reentregas_rota ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "acesso_total_anon" ON reentregas_rota;
CREATE POLICY "acesso_total_anon" ON reentregas_rota
    FOR ALL TO anon USING (true) WITH CHECK (true);

