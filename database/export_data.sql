-- =============================================================================
-- SCRIPT DE CARGA INICIAL - SISTEMA JR SAC & LOGÍSTICA CORPORATIVA
-- VERSÃO PRODUÇÃO: dados zerados para início de operação
-- Apenas dados mestre (setores, usuários, motoristas, veículos, produtos)
-- NÃO inclui ocorrências de exemplo — sistema inicia limpo
-- =============================================================================

-- 1. SETORES CORPORATIVOS (obrigatório para o sistema funcionar)
INSERT INTO setores (codigo, nome, descricao) VALUES
('SAC',   'SAC / Operação Logística',    'Gestão de devoluções e atendimento a clientes'),
('CD',    'Centro de Distribuição',      'Conferência, recebimento e destinação de mercadorias'),
('FIN',   'Financeiro & Comercial',      'Tratativa fiscal e formas de acerto'),
('FROTA', 'Manutenção & Frota',          'Controle de veículos, socorro mecânico e rotas')
ON CONFLICT (codigo) DO NOTHING;

-- 2. USUÁRIOS INICIAIS (senha padrão: trocar no primeiro acesso)
-- A senha_hash abaixo equivale à string vazia "" em SHA-256 (sem senha — trocar!)
INSERT INTO usuarios (nome, email, senha_hash, role, cargo, ativo) VALUES
('Administrador JR',       'admin@jrdistribuidora.com.br',       'e3b0c44298fc1c149afbf4c8996fb924', 'ADMIN',      'Administrador do Sistema',  true),
('Operador SAC',           'sac@jrdistribuidora.com.br',         'e3b0c44298fc1c149afbf4c8996fb924', 'SAC',        'Analista de SAC',           true),
('Conferente CD',          'cd@jrdistribuidora.com.br',          'e3b0c44298fc1c149afbf4c8996fb924', 'CD',         'Supervisor de CD',          true),
('Analista Financeiro',    'financeiro@jrdistribuidora.com.br',  'e3b0c44298fc1c149afbf4c8996fb924', 'FINANCEIRO', 'Analista Financeiro',       true),
('Coordenador de Frota',   'manutencao@jrdistribuidora.com.br',  'e3b0c44298fc1c149afbf4c8996fb924', 'MANUTENCAO', 'Coordenador de Frota',      true)
ON CONFLICT (email) DO NOTHING;

-- 3. MOTORISTAS (adicione os da sua empresa aqui ou pelo próprio sistema)
-- Este é apenas um exemplo — pode apagar e cadastrar direto no app
INSERT INTO motoristas (nome, cnh, telefone, ativo) VALUES
('A cadastrar', '00000000000', '(00) 00000-0000', false)
ON CONFLICT (cnh) DO NOTHING;

-- 4. VEÍCULOS (adicione os da sua frota aqui ou pelo próprio sistema)
INSERT INTO veiculos (placa, modelo, tipo, capacidade_kg, ativo) VALUES
('MODELO-01', 'A cadastrar', 'VUC', 0, false)
ON CONFLICT (placa) DO NOTHING;

-- 5. PRODUTOS (adicione os da sua operação aqui ou pelo próprio sistema)
INSERT INTO produtos (codigo_produto, descricao, categoria, valor_unitario_padrao) VALUES
('PROD-MODELO', 'Produto de Exemplo — Cadastre os seus pelo sistema', 'Geral', 0.00)
ON CONFLICT (codigo_produto) DO NOTHING;

-- =============================================================================
-- FIM DO SCRIPT
-- O sistema está pronto para uso. Todas as ocorrências serão criadas pela equipe.
-- =============================================================================
