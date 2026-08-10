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
    descricao TEXT NOT NULL,
    midia_fotos TEXT,
    midia_videos TEXT,
    transcricao_audio_wa TEXT,
    status VARCHAR(30) NOT NULL DEFAULT 'ABERTO' CHECK (status IN ('ABERTO', 'EM_ATENDIMENTO', 'RESOLVIDO')),
    veiculo_parado BOOLEAN DEFAULT TRUE,
    mecanico_responsavel_id INT REFERENCES usuarios(id),
    acao_mecanico TEXT,
    pecas_trocadas TEXT,
    guincho_acionado BOOLEAN DEFAULT FALSE,
    custo_socorro DECIMAL(10,2) DEFAULT 0.00,
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

-- Política: permite acesso total a usuários anônimos (toda a empresa usa a mesma chave)
CREATE POLICY "acesso_total_anon" ON setores FOR ALL TO anon USING (true) WITH CHECK (true);
CREATE POLICY "acesso_total_anon" ON usuarios FOR ALL TO anon USING (true) WITH CHECK (true);
CREATE POLICY "acesso_total_anon" ON motoristas FOR ALL TO anon USING (true) WITH CHECK (true);
CREATE POLICY "acesso_total_anon" ON ajudantes FOR ALL TO anon USING (true) WITH CHECK (true);
CREATE POLICY "acesso_total_anon" ON veiculos FOR ALL TO anon USING (true) WITH CHECK (true);
CREATE POLICY "acesso_total_anon" ON clientes FOR ALL TO anon USING (true) WITH CHECK (true);
CREATE POLICY "acesso_total_anon" ON produtos FOR ALL TO anon USING (true) WITH CHECK (true);
CREATE POLICY "acesso_total_anon" ON cargas FOR ALL TO anon USING (true) WITH CHECK (true);
CREATE POLICY "acesso_total_anon" ON ocorrencias_devolucao FOR ALL TO anon USING (true) WITH CHECK (true);
CREATE POLICY "acesso_total_anon" ON itens_devolucao FOR ALL TO anon USING (true) WITH CHECK (true);
CREATE POLICY "acesso_total_anon" ON relatorios_divergencia FOR ALL TO anon USING (true) WITH CHECK (true);
CREATE POLICY "acesso_total_anon" ON itens_relatorio_divergencia FOR ALL TO anon USING (true) WITH CHECK (true);
CREATE POLICY "acesso_total_anon" ON ocorrencias_rota FOR ALL TO anon USING (true) WITH CHECK (true);
CREATE POLICY "acesso_total_anon" ON trocas_veiculos FOR ALL TO anon USING (true) WITH CHECK (true);
CREATE POLICY "acesso_total_anon" ON auditoria_produtividade FOR ALL TO anon USING (true) WITH CHECK (true);

-- =============================================================================
-- VIEWS OTIMIZADAS PARA POWER BI
-- =============================================================================

-- VIEW 1: PRODUTIVIDADE DA EQUIPE
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
CREATE OR REPLACE VIEW vw_bi_frota_veiculos_parados AS
SELECT 
    v.placa,
    v.modelo,
    m.nome AS motorista_nome,
    c.numero_carga,
    c.rota,
    o.tipo_ocorrencia,
    o.descricao,
    o.veiculo_parado,
    o.status AS status_manutencao,
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
CREATE OR REPLACE VIEW vw_bi_trocas_veiculos AS
SELECT 
    id, data, veiculo_escalado, veiculo_trocado, motivo_resumido,
    motivo_outro, detalhamento, autorizado_por, criado_em
FROM trocas_veiculos;
