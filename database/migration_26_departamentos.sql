-- =============================================================================
-- MIGRACAO 26 - DEPARTAMENTOS COMO CADASTRO DO ADMIN (23/08/2026)
--
-- PROBLEMA: existiam DUAS listas de departamento fixas no codigo, com nomes
-- diferentes, e nenhuma das duas era editavel por ninguem:
--
--   DEPARTAMENTOS_PADRAO (js/app.js)  -> usada na tela de autocadastro
--     "GERENTE GERAL", "SUPERVISOR OPERACAO", "CENTRO DE DISTRIBUICAO"...
--   INITIAL_DATA.departamentos        -> usada na tela "Logins e Senhas"
--     "GERENCIA GERAL", "GERENCIA OPERACIONAL", "SUPERVISAO", "COMERCIAL"...
--
-- A funcao que decide o papel de acesso (mapDeptToRoleAndCargo) compara com
-- os nomes da PRIMEIRA lista. Quem tivesse um nome so da segunda nao casava
-- com nada e caia no padrao 'SAC' - a gerencia e a supervisao recebendo o
-- papel de menor alcance do sistema, em silencio. Nao quebrava nada enquanto
-- o menu nao filtrava por papel; quebraria no dia em que passasse a filtrar.
--
-- CORRECAO: o departamento sai do codigo e vira cadastro, com o papel de
-- acesso ao lado, editavel pelo admin em "Logins e Senhas" - no mesmo lugar
-- onde ele ja controla quem entra no sistema.
--
-- POR QUE PRECISA DE TABELA: sem ela o cadastro vive so no localStorage do
-- aparelho que o fez. O admin mudaria "SUPERVISAO: SAC" para
-- "SUPERVISAO: GESTOR" no PC e o celular de todo mundo continuaria com o
-- valor antigo. E exatamente o que a migracao 25 corrigiu para rotas e
-- motivos de devolucao - mesmo problema, mesma solucao.
--
-- Rode o arquivo inteiro no SQL Editor do Supabase. E idempotente.
-- =============================================================================

BEGIN;

-- -----------------------------------------------------------------------
-- 26.1 TABELA
--
-- A chave primaria e o proprio NOME, nao um id sintetico - mesmo raciocinio
-- de `rotas` e `motivos_devolucao` na migracao 25: e o nome que esta gravado
-- em usuarios.departamento, e e por ele que o Power BI vai cruzar. Um id
-- novo so criaria uma juncao a mais sem representar nada de negocio.
--
-- `role` e o papel de acesso que o usuario daquele departamento herda. E
-- CHECK, nao FK, porque a lista de papeis vive no JavaScript
-- (roles_disponiveis) e nao tem tabela propria - o CHECK garante que nao
-- entre um valor que o app nao saiba interpretar.
--
-- `ativo` e o que faz a EXCLUSAO viajar entre aparelhos: o envio do app e
-- um upsert e nunca apaga linha, entao remover um departamento apenas da
-- lista local seria desfeito na proxima leitura, que o traria de volta do
-- banco (o classico "excluí e voltou sozinho"). Desativar pela tela grava
-- ativo=false e todo aparelho que ler essa linha tira o item da sua lista.
-- Ninguem perde historico: um usuario antigo continua apontando para o nome
-- do departamento mesmo depois dele sair de circulacao.
-- -----------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS departamentos (
    nome  VARCHAR(80) PRIMARY KEY,
    role  VARCHAR(20) NOT NULL DEFAULT 'SAC',
    cargo VARCHAR(80) DEFAULT '',
    ativo BOOLEAN NOT NULL DEFAULT TRUE,
    criado_em     TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    atualizado_em TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Colunas adicionadas em separado para o caso de a tabela ja existir de uma
-- execucao parcial anterior.
ALTER TABLE departamentos ADD COLUMN IF NOT EXISTS role  VARCHAR(20) NOT NULL DEFAULT 'SAC';
ALTER TABLE departamentos ADD COLUMN IF NOT EXISTS cargo VARCHAR(80) DEFAULT '';
ALTER TABLE departamentos ADD COLUMN IF NOT EXISTS ativo BOOLEAN NOT NULL DEFAULT TRUE;

-- O CHECK precisa aceitar exatamente os 6 papeis de roles_disponiveis.
-- Recriado sempre, para o caso de a lista de papeis mudar no futuro.
ALTER TABLE departamentos DROP CONSTRAINT IF EXISTS departamentos_role_check;
ALTER TABLE departamentos ADD CONSTRAINT departamentos_role_check
    CHECK (role IN ('SAC', 'CD', 'FINANCEIRO', 'MANUTENCAO', 'GESTOR', 'ADMIN'));

-- -----------------------------------------------------------------------
-- 26.2 RLS - mesmo padrao de todas as outras tabelas do projeto
-- -----------------------------------------------------------------------
ALTER TABLE departamentos ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "acesso_total_anon" ON departamentos;
CREATE POLICY "acesso_total_anon" ON departamentos FOR ALL TO anon USING (true) WITH CHECK (true);

-- -----------------------------------------------------------------------
-- 26.3 SEMEADURA - a UNIAO das duas listas antigas
--
-- Cada uma entra com o papel que o sistema JA dava a ela hoje, para que
-- ninguem mude de acesso por causa desta migracao. As unicas que ganham
-- papel diferente do atual sao as que hoje caem no padrao 'SAC' por falha
-- de comparacao e que claramente nao sao SAC: GERENCIA GERAL, GERENCIA
-- OPERACIONAL e SUPERVISAO viram GESTOR.
--
-- COMERCIAL e COMPRAS ficam em 'SAC' de proposito - e o que recebem hoje, e
-- conceder acesso novo sem alguem decidir seria pior do que manter. O admin
-- ajusta pela tela "Logins e Senhas" quando quiser.
--
-- ON CONFLICT DO NOTHING: rodar de novo nao desfaz nenhuma alteracao que o
-- admin ja tenha feito pela tela.
-- -----------------------------------------------------------------------
INSERT INTO departamentos (nome, role, cargo) VALUES
    ('SAC',                    'SAC',        'Analista de SAC'),
    ('MONITORAMENTO',          'MANUTENCAO', 'Analista de Monitoramento'),
    ('RASTREAMENTO',           'MANUTENCAO', 'Analista de Monitoramento'),
    ('CENTRO DE DISTRIBUIÇÃO', 'CD',         'Operador / Líder CD'),
    ('MANUTENÇÃO',             'MANUTENCAO', 'Analista de Manutenção'),
    ('SUPERVISOR CD',          'CD',         'Supervisor CD'),
    ('SUPERVISOR OPERAÇÃO',    'GESTOR',     'Gestor Operacional'),
    ('GERENTE CD',             'GESTOR',     'Gestor Operacional'),
    ('GERENTE GERAL',          'GESTOR',     'Gestor Operacional'),
    ('FATURAMENTO',            'FINANCEIRO', 'Analista Financeiro'),
    ('MONTAGEM CARGA',         'CD',         'Operador / Líder CD'),
    ('ANALISTA/BI',            'ADMIN',      'Analista de BI / Logística'),
    ('ANALISTA',               'ADMIN',      'Analista de BI / Logística'),
    ('GERÊNCIA GERAL',         'GESTOR',     'Gestor Operacional'),
    ('GERÊNCIA OPERACIONAL',   'GESTOR',     'Gestor Operacional'),
    ('SUPERVISÃO',             'GESTOR',     'Gestor Operacional'),
    ('MONTAGEM DE CARGA',      'CD',         'Operador / Líder CD'),
    ('COMERCIAL',              'SAC',        'Analista Comercial'),
    ('COMPRAS',                'SAC',        'Analista de Compras')
ON CONFLICT (nome) DO NOTHING;

COMMIT;

-- =============================================================================
-- CONFERENCIA - rode depois e compare com o esperado
--
--   SELECT count(*) FROM departamentos;                      -- esperado: >= 19
--   SELECT count(*) FROM departamentos WHERE ativo;          -- esperado: >= 19
--
-- Quem esta em qual papel:
--   SELECT role, count(*), string_agg(nome, ', ' ORDER BY nome)
--     FROM departamentos WHERE ativo GROUP BY role ORDER BY role;
--
-- Usuarios cujo departamento NAO existe no cadastro (esses caem no "falha
-- aberto" do menu e veem tudo - vale corrigir o cadastro deles ou incluir o
-- departamento):
--   SELECT u.nome, u.departamento, u.role
--     FROM usuarios u
--     LEFT JOIN departamentos d ON upper(trim(d.nome)) = upper(trim(u.departamento))
--    WHERE u.departamento IS NOT NULL AND u.departamento <> '' AND d.nome IS NULL;
--
-- Usuarios cujo `role` gravado diverge do papel do proprio departamento (nao
-- e erro: o admin pode ter dado acesso especifico a alguem. So vale saber):
--   SELECT u.nome, u.departamento, u.role AS role_usuario, d.role AS role_departamento
--     FROM usuarios u
--     JOIN departamentos d ON upper(trim(d.nome)) = upper(trim(u.departamento))
--    WHERE upper(trim(u.role)) <> upper(trim(d.role));
-- =============================================================================
