-- =============================================================================
-- MIGRATION 56 — Escala de embarques (30/10/2026)
-- =============================================================================
-- Sai com a v6.10.0 (menu novo "Escala": Matrizes, Convocação Escala e
-- Fechamento). Substitui as planilhas "Gestão de embarques - Matriz" (uma por
-- dia da semana) e os "FECHAMENTO DIA dd.mm.aaaa.xlsx".
--
--   escala_matrizes — o modelo de cada dia da semana (1 = segunda ... 6 =
--                     sábado), uma linha por rota. retorno_dias/retorno_hora
--                     dão a previsão de chegada: saída + N dias, na hora
--                     indicada. Semeada com as 6 matrizes de 30/10/2026 e com
--                     os retornos de "Horário Fechamento Rotas (2025.11)"
--                     (rota sem par lá ficou com 0 dia / 23:59 — ajustar na
--                     tela).
--   escala_linhas   — a escala de um dia: uma linha por viagem. carga, peso,
--                     valor e qt_entregas são do fechamento; viagem_id aponta
--                     para controle_viagens (a viagem nasce quando a carga é
--                     informada); troca_id aponta para trocas_veiculos (placa
--                     diferente da matriz).
--
-- AS DUAS TABELAS FICAM FORA DA SINCRONIZAÇÃO AUTOMÁTICA DO APP, de propósito
-- (egress, ver 6.8.1): a tela lê da nuvem ao abrir e grava direto, como a
-- Produtividade. Nada disso vai para o localStorage.
--
-- Mesmo padrão das demais: PK BIGINT gerado pelo app, RLS com
-- acesso_total_anon, soft delete, atualizado_em carimbado pelo app e guardado
-- por jr_recusar_carimbo_regressivo() (migration 45).
--
-- Idempotente: pode rodar duas vezes (a semente usa ON CONFLICT DO NOTHING).
-- =============================================================================

CREATE TABLE IF NOT EXISTS escala_matrizes (
    id                    BIGINT PRIMARY KEY,
    dia_semana            SMALLINT NOT NULL,
    setor                 VARCHAR(10) NOT NULL DEFAULT 'FRIO',
    ordem                 INT NOT NULL DEFAULT 0,
    rota                  VARCHAR(120) NOT NULL,
    placa                 VARCHAR(10),
    motorista             VARCHAR(160),
    ajudante              VARCHAR(160),
    observacao            VARCHAR(200),
    retorno_dias          SMALLINT NOT NULL DEFAULT 0,
    retorno_hora          VARCHAR(5) NOT NULL DEFAULT '23:59',
    criado_por            VARCHAR(120),
    criado_em             TIMESTAMP,
    atualizado_por        VARCHAR(120),
    atualizado_em         TIMESTAMP,
    is_deleted            BOOLEAN DEFAULT FALSE,
    deleted_at            TIMESTAMP,
    deleted_by_nome       VARCHAR(120),
    CONSTRAINT ck_escala_matrizes_dia CHECK (dia_semana BETWEEN 1 AND 7),
    CONSTRAINT ck_escala_matrizes_setor CHECK (setor IN ('FRIO', 'SECO'))
);
ALTER TABLE escala_matrizes ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "acesso_total_anon" ON escala_matrizes;
CREATE POLICY "acesso_total_anon" ON escala_matrizes FOR ALL TO anon USING (true) WITH CHECK (true);
CREATE INDEX IF NOT EXISTS idx_escala_matrizes_dia ON escala_matrizes (dia_semana) WHERE is_deleted IS NOT TRUE;
DROP TRIGGER IF EXISTS trg_escala_matrizes_guarda_carimbo ON escala_matrizes;
CREATE TRIGGER trg_escala_matrizes_guarda_carimbo
  BEFORE UPDATE ON escala_matrizes
  FOR EACH ROW EXECUTE FUNCTION public.jr_recusar_carimbo_regressivo();

CREATE TABLE IF NOT EXISTS escala_linhas (
    id                    BIGINT PRIMARY KEY,
    data_escala           DATE NOT NULL,
    setor                 VARCHAR(10) NOT NULL DEFAULT 'FRIO',
    ordem                 INT NOT NULL DEFAULT 0,
    rota                  VARCHAR(120) NOT NULL,
    placa                 VARCHAR(10),
    placa_matriz          VARCHAR(10),
    motorista             VARCHAR(160),
    ajudante              VARCHAR(160),
    observacao            VARCHAR(200),
    previsao_retorno      TIMESTAMP,
    carga                 VARCHAR(60),
    peso                  NUMERIC(12,2),
    valor                 NUMERIC(14,2),
    qt_entregas           INT,
    matriz_id             BIGINT,
    viagem_id             BIGINT,
    troca_id              BIGINT,
    criado_por            VARCHAR(120),
    criado_em             TIMESTAMP,
    atualizado_por        VARCHAR(120),
    atualizado_em         TIMESTAMP,
    is_deleted            BOOLEAN DEFAULT FALSE,
    deleted_at            TIMESTAMP,
    deleted_by_nome       VARCHAR(120),
    CONSTRAINT ck_escala_linhas_setor CHECK (setor IN ('FRIO', 'SECO'))
);
ALTER TABLE escala_linhas ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "acesso_total_anon" ON escala_linhas;
CREATE POLICY "acesso_total_anon" ON escala_linhas FOR ALL TO anon USING (true) WITH CHECK (true);
CREATE INDEX IF NOT EXISTS idx_escala_linhas_data ON escala_linhas (data_escala) WHERE is_deleted IS NOT TRUE;
DROP TRIGGER IF EXISTS trg_escala_linhas_guarda_carimbo ON escala_linhas;
CREATE TRIGGER trg_escala_linhas_guarda_carimbo
  BEFORE UPDATE ON escala_linhas
  FOR EACH ROW EXECUTE FUNCTION public.jr_recusar_carimbo_regressivo();

-- Semente: as 6 matrizes de 30/10/2026 (S:\...\MATRIZ - GESTÃO DE EMBARQUE).
INSERT INTO escala_matrizes
  (id, dia_semana, setor, ordem, rota, placa, motorista, ajudante, observacao, retorno_dias, retorno_hora, criado_por, criado_em)
VALUES
  (1, 1, 'FRIO', 1, 'CAMPOS LINDOS', 'RSE9G70', 'NILMAR PEREIRA DOS SANTOS SOUZA', 'OZIEL RODRIGUES DA SILVA', NULL, 1, '23:59', 'MIGRATION 56', now()),
  (2, 1, 'FRIO', 2, 'COMBINADO', 'RSE9G63', 'RENATO DIAS PEREIRA', 'RENATO DOS REIS ALVES', NULL, 2, '23:59', 'MIGRATION 56', now()),
  (3, 1, 'FRIO', 3, 'FORMOSO DO ARAGUAIA', 'RSE9G93', 'DIOGENES MARTINS DA SILVA', 'MARCOS ROBERTO TIMOTEO DE LIMA', NULL, 2, '23:59', 'MIGRATION 56', now()),
  (4, 1, 'FRIO', 4, 'GURUPI', 'TVA8I21', 'NANDERSON MOTA DE ARAUJO', 'GUSTAVO CARVALHO DA SILVA', NULL, 1, '23:59', 'MIGRATION 56', now()),
  (5, 1, 'FRIO', 5, 'MIRACEMA', 'RMC7H57', 'DERVAL FIRMINO MARTINS', 'MAURICIO PIRES SANTOS', NULL, 1, '23:59', 'MIGRATION 56', now()),
  (6, 1, 'FRIO', 6, 'PALMAS NORTE', 'OLI2E18', 'EDSON / ALESSANCO', 'MARISON DA CRUZ LIMA SANTOS', 'ARMANDO - RSC7E69', 0, '23:59', 'MIGRATION 56', now()),
  (7, 1, 'FRIO', 7, 'PALMAS SUL', 'OLH8E48', 'GLEDSON RODRIGUES DE BORBA', 'DOUGLAS FERREIRA SILVA', NULL, 0, '23:59', 'MIGRATION 56', now()),
  (8, 1, 'FRIO', 8, 'TAQUARALTO', 'OLI2E91', 'DIOGO COIMBRA DA SILVA', 'KAUA CAIRO DOS SANTOS DE SOUZA', NULL, 0, '23:59', 'MIGRATION 56', now()),
  (9, 1, 'FRIO', 9, 'PALMEIRÓPOLIS', 'RMC7H59', 'IGOR GOMES DA SILVA', 'WILLIAM MELQUIADES DE SANTANA', 'ANDERSON - RSD8J69', 0, '23:59', 'MIGRATION 56', now()),
  (10, 1, 'FRIO', 10, 'DIANÓPOLIS', 'RMC7H05', 'EDIMAR MONTELO DE FREITAS', 'GUSTAVO ALVES PIMENTEL', NULL, 1, '18:00', 'MIGRATION 56', now()),
  (11, 1, 'FRIO', 11, 'PORTO / NATIVIDADE', 'TVA8I18', 'RAIMUNDO / OZIEL GOMES', 'JEFERSON ALVES DA SILVA', 'ADEMAR - RMC7H72', 0, '23:59', 'MIGRATION 56', now()),
  (12, 1, 'FRIO', 12, 'PARAÍSO DO TOCANTINS', 'OLI0E88', 'WENNEM RUDEMBERG CASTRO DOS SANTOS', 'GUILHERME DE OLIVEIRA RAMALHO', NULL, 0, '23:59', 'MIGRATION 56', now()),
  (13, 1, 'FRIO', 13, 'ITACAJÁ', 'TVA8I12', 'JOSE DOS REIS DA SILVA SANTOS', 'EDSON DOS SANTOS SILVA', NULL, 1, '23:59', 'MIGRATION 56', now()),
  (14, 1, 'FRIO', 14, 'ARAGUAINA', 'QWA2318', 'MATHEUS HENRIQUE ANDRADE DE SOUSA', 'JUAN RAMIREZ GAMA COSTA', NULL, 0, '18:00', 'MIGRATION 56', now()),
  (15, 1, 'FRIO', 15, 'MARABA I', 'RSE9G00', 'JHONATAN SILVA DOS SANTOS', 'WESLY DA CONCEIÇAO LIMA', 'JHONATA - RSE9G00', 1, '23:59', 'MIGRATION 56', now()),
  (16, 1, 'FRIO', 16, 'MARABA II', 'TVB2I32', 'DIEGO MORAES DA SILVA', 'RUBENS SILVA GONÇALVES VIANA', NULL, 1, '23:59', 'MIGRATION 56', now()),
  (17, 1, 'FRIO', 17, 'NOVO REPARTIMENTO', 'RMC7H61', 'LUCIO RODRIGUES BOTELHO', 'LUCAS GOMES DA SILVA', NULL, 2, '12:00', 'MIGRATION 56', now()),
  (18, 1, 'FRIO', 18, 'BALSAS - MA', 'TVD0F56', 'JEREMIAS FRANCA SOUSA', 'ADRIANO NASCIMENTO DE CASTRO', NULL, 0, '23:59', 'MIGRATION 56', now()),
  (19, 1, 'FRIO', 19, 'SÃO FELIX, XINGUARA E TUCUMÃ', 'RMC7H67', 'GILCIMAR GOMES BARROS', 'RAIMUNDO NONATO DE JESUS PEREIRA', NULL, 2, '23:59', 'MIGRATION 56', now()),
  (20, 1, 'SECO', 20, 'SECO - CENTRO SUL', 'RSB4G64', 'ELINALDO FERREIRA DE SOUZA', 'GUSTAVO COSTA DA SILVA', NULL, 2, '18:00', 'MIGRATION 56', now()),
  (21, 1, 'SECO', 21, 'SECO - PALMAS', 'TVA8I14', 'NILVAN OLIVEIRA DE SOUSA', 'ANOEL FILHO T. DOS SANTOS', NULL, 3, '18:00', 'MIGRATION 56', now()),
  (22, 1, 'SECO', 22, 'SECO - BICO', 'RSB4G54', 'PAULO DOS SANTOS RIBEIRO', 'DOUGLAS ALEXANDRE SANTOS FERREIRA', NULL, 2, '18:00', 'MIGRATION 56', now()),
  (23, 1, 'SECO', 23, 'SECO - CENTRO NORTE', 'RSB4D44', 'DHANIEL MACIEL SALES', 'GENIVALDO RIBEIRO DOS SANTOS', NULL, 1, '23:59', 'MIGRATION 56', now()),
  (24, 1, 'SECO', 24, 'SECO - CAMPUS LINDO', 'MWP6E08', 'GLEISON RODRIGUES DIAS', 'RAIMUNDO DA SILVA RIBEIRO', NULL, 0, '23:59', 'MIGRATION 56', now()),
  (25, 1, 'SECO', 25, 'SECO - ARAGUAINA', 'RSC0C13', 'FELIX AVELINO DE BRITO GUIDA', 'EDUARDO MEDANHA DO SANTOS', NULL, 0, '23:59', 'MIGRATION 56', now()),
  (26, 2, 'FRIO', 1, 'ARAGUAINA CENTRO', 'RSC7E49', 'CHARLES SOARES LOPES', 'KAUAN / EDSON', NULL, 0, '23:59', 'MIGRATION 56', now()),
  (27, 2, 'FRIO', 2, 'ARAGUAINA MARACANÃ', 'RSE9G60', 'FRANCISCO JUNIOR DE FREITAS', 'DOUGLAS DA COSTA LIMA', NULL, 0, '23:59', 'MIGRATION 56', now()),
  (28, 2, 'FRIO', 3, 'ARAGUAINA III', 'RSE9G33', 'RODRIGO OLIVEIRA SOUSA', 'RENIO / MARCOS ROBERTO', NULL, 0, '23:59', 'MIGRATION 56', now()),
  (29, 2, 'FRIO', 4, 'REDE CAMPELO', 'QWA2318', 'ADEMAR FILHO SILVA DE OLIVEIRA', 'JOSE LEANDRO DA SILVA CHAVES', NULL, 0, '23:59', 'MIGRATION 56', now()),
  (30, 2, 'FRIO', 5, 'PALMAS NORTE', 'OLI2E18', 'EDSON / ALESSANCO', 'MARISON DA CRUZ LIMA SANTOS', NULL, 0, '23:59', 'MIGRATION 56', now()),
  (31, 2, 'FRIO', 6, 'PALMAS SUL', 'OLH8E48', 'GLEDSON RODRIGUES DE BORBA', 'DOUGLAS FERREIRA SILVA', NULL, 0, '23:59', 'MIGRATION 56', now()),
  (32, 2, 'FRIO', 7, 'TAQUARALTO', 'OLI2E91', 'DIOGO COIMBRA DA SILVA', 'KAUA CAIRO DOS SANTOS DE SOUZA', NULL, 0, '23:59', 'MIGRATION 56', now()),
  (33, 2, 'FRIO', 8, 'PARAÍSO DO TOCANTINS', 'OLI0E88', 'WENNEM RUDEMBERG CASTRO DOS SANTOS', 'GUILHERME DE OLIVEIRA RAMALHO', NULL, 0, '23:59', 'MIGRATION 56', now()),
  (34, 2, 'FRIO', 9, 'COLINAS', 'TVA8I23', 'LINDURVAN ALENCAR DE SOUSA', 'JOSE PAIXAO COELHO DA SILVA', NULL, 1, '18:00', 'MIGRATION 56', now()),
  (35, 2, 'FRIO', 10, 'TOCANTINÓPOLIS', 'RSE9H70', 'JEFERSON ALVES VERA', 'JOSE DE RIBAMAR DE SOUSA ROCHA', NULL, 0, '23:59', 'MIGRATION 56', now()),
  (36, 2, 'FRIO', 11, 'XAMBIOÁ', 'TVA8I14', 'JOAO EVANGELISTA FAUSTINO DA SILVA', 'NATAL DOS REIS', NULL, 0, '23:59', 'MIGRATION 56', now()),
  (37, 2, 'FRIO', 12, 'SECO - ARAGUAINA', 'RSE9F93', 'MATHEUS HENRIQUE ANDRADE DE SOUSA', 'LUCAS CARLOS / GUSTAVO COSTA', NULL, 0, '23:59', 'MIGRATION 56', now()),
  (38, 3, 'FRIO', 1, 'PALMAS NORTE', 'OLI2E18', 'EDSON VELOSO MENDES', 'MARISON DA CRUZ LIMA SANTOS', NULL, 0, '23:59', 'MIGRATION 56', now()),
  (39, 3, 'FRIO', 2, 'PALMAS SUL', 'OLH8E48', 'OSEAN RODRIGUES SANTOS', 'LUIZ MIGUEL DE REZENDE SANTOS', NULL, 0, '23:59', 'MIGRATION 56', now()),
  (40, 3, 'FRIO', 3, 'TAQUARALTO', 'OLI2E91', 'DIOGO COIMBRA DA SILVA', 'ALISON CARMO LEITE', NULL, 0, '23:59', 'MIGRATION 56', now()),
  (41, 3, 'FRIO', 4, 'PORTO NACIONAL', 'TVA8I18', 'RAIMUNDO CAVALCANTE SILVA FILHO', 'JEFERSON ALVES DA SILVA', NULL, 0, '23:59', 'MIGRATION 56', now()),
  (42, 3, 'FRIO', 5, 'PARAÍSO DO TOCANTINS', 'OLI0E88', 'WENNEM RUDEMBERG CASTRO DOS SANTOS', 'GUILHERME DE OLIVEIRA RAMALHO', NULL, 0, '23:59', 'MIGRATION 56', now()),
  (43, 3, 'FRIO', 6, 'ARAGUAINA CENTRO', 'TVD0F56', 'JEFERSON ALVES VERA', 'KAUAN / MARCOS ROBERTO', NULL, 0, '23:59', 'MIGRATION 56', now()),
  (44, 3, 'FRIO', 7, 'ARAGUAINA MARACANÃ', 'TVD1E68', 'RICARDO BATISTA FREITAS', 'RENIO / GUSTAVO COSTA', NULL, 0, '23:59', 'MIGRATION 56', now()),
  (45, 3, 'FRIO', 8, 'ARAGUAINA III', 'RSC8G18', 'GLEISON RODRIGUES DIAS', 'MARCOS VINICIUS FARIAS DE SOUS', NULL, 0, '23:59', 'MIGRATION 56', now()),
  (46, 3, 'FRIO', 9, 'NOVA OLINDA', 'TVA8I14', 'JOAO EVANGELISTA FAUSTINO DA SILVA', 'NATAL DOS REIS', NULL, 0, '23:59', 'MIGRATION 56', now()),
  (47, 3, 'FRIO', 10, 'BABAÇULÃNDIA E FILADÉLFIA', 'RSD7I68', 'ANDERSON JUNIOR ALVES LIMA', 'ALMIR ALVES DA SILVA', NULL, 0, '23:59', 'MIGRATION 56', now()),
  (48, 3, 'FRIO', 11, 'AÇAILANDIA - MA', 'RSE9G60', 'FRANCISCO JUNIOR DE FREITAS', 'DOUGLAS ALEXANDRE SANTOS FERREIRA', NULL, 0, '23:59', 'MIGRATION 56', now()),
  (49, 3, 'FRIO', 12, 'MARABA 01', 'RSE9G33', 'RODRIGO OLIVEIRA SOUSA', 'WESLY DA CONCEIÇAO LIMA', NULL, 2, '23:59', 'MIGRATION 56', now()),
  (50, 3, 'FRIO', 13, 'MARABA 02', 'TVB2I32', 'DIEGO MORAES DA SILVA', 'RUBENS SILVA GONÇALVES VIANA', NULL, 2, '23:59', 'MIGRATION 56', now()),
  (51, 3, 'FRIO', 14, 'CONCEIÇÃO, REDEN E SANTANA', 'RSE9G23', 'FELIX AVELINO DE BRITO GUIDA', 'OZIEL RODRIGUES DA SILVA', NULL, 2, '23:59', 'MIGRATION 56', now()),
  (52, 3, 'FRIO', 15, 'ALIANÇA', 'RSC7E49', 'CHARLES SOARES LOPES', 'DOUGLAS DA COSTA LIMA', '11 HORAS', 0, '23:59', 'MIGRATION 56', now()),
  (53, 3, 'SECO', 16, 'SECO - ARAGUAINA', 'RSC0C13', 'JOAO PAULLO MARTINS DE SOUSA', 'EDUARDO MEDANHA DO SANTOS', NULL, 0, '23:59', 'MIGRATION 56', now()),
  (54, 4, 'FRIO', 1, 'ALIANÇA', 'RSC7E49', 'CHARLES SOARES LOPES', 'DOUGLAS DA COSTA LIMA', NULL, 0, '23:59', 'MIGRATION 56', now()),
  (55, 4, 'FRIO', 2, 'GURUPI', 'TVA8I21', 'MATHEUS HENRIQUE ANDRADE DE SOUSA', 'GUSTAVO CARVALHO DA SILVA', NULL, 1, '23:59', 'MIGRATION 56', now()),
  (56, 4, 'FRIO', 3, 'LAGOA DA CONFUSÃO', 'RSC7E79', 'JEFERSON ALVES VERA', 'ADRIANO NASCIMENTO DE CASTRO', NULL, 1, '23:59', 'MIGRATION 56', now()),
  (57, 4, 'FRIO', 4, 'AUGUSTINOPOLIS', 'RMC7H57', 'DERVAL FIRMINO MARTINS', 'MAURICIO PIRES SANTOS', NULL, 1, '23:59', 'MIGRATION 56', now()),
  (58, 4, 'FRIO', 5, 'ARAGUATINS', 'RSE9G70', 'NILMAR PEREIRA DOS SANTOS', 'JUAN RAMIREZ GAMA COSTA', NULL, 1, '23:59', 'MIGRATION 56', now()),
  (59, 4, 'FRIO', 6, 'DIVINÓPOLIS', 'RMC7H72', 'ADEMAR FILHO SILVA DE OLIVEIRA', 'ANOEL FILHO T. DOS SANTOS', NULL, 1, '23:59', 'MIGRATION 56', now()),
  (60, 4, 'FRIO', 7, 'PALMAS NORTE', 'OLI2E18', 'EDSON VELOSO MENDES', 'KAUA CAIRO DOS SANTOS DE SOUZA', NULL, 0, '23:59', 'MIGRATION 56', now()),
  (61, 4, 'FRIO', 8, 'PALMAS SUL', 'OLH8E48', 'GLEDSON RODRIGUES DE BORBA', 'DOUGLAS FERREIRA SILVA', NULL, 0, '23:59', 'MIGRATION 56', now()),
  (62, 4, 'FRIO', 9, 'MIRACEMA', 'TVA8I18', 'RAIMUNDO / ALESSANCO', 'JEFERSON ALVES DA SILVA', NULL, 0, '23:59', 'MIGRATION 56', now()),
  (63, 4, 'FRIO', 10, 'TAQUARALTO', 'OLI2E91', 'DIOGO COIMBRA DA SILVA', 'OZIEL GOMES DE JESUS', NULL, 0, '23:59', 'MIGRATION 56', now()),
  (64, 4, 'FRIO', 11, 'SERRA DO LAJEADO', 'RMC7H59', 'EDIMAR MONTELO DE FREITAS', 'GUSTAVO ALVES PIMENTEL', NULL, 0, '23:59', 'MIGRATION 56', now()),
  (65, 4, 'FRIO', 12, 'PARAISO DO TOCANTINS', 'OLI0E88', 'WENNEM RUDEMBERG CASTRO DOS SANTOS', 'GUILHERME DE OLIVEIRA RAMALHO', NULL, 0, '23:59', 'MIGRATION 56', now()),
  (66, 4, 'FRIO', 13, 'PEDRO AFONSO', 'TVA8I12', 'JOSE DOS REIS DA SILVA SANTOS', 'GENIVALDO RIBEIRO DOS SANTOS', NULL, 1, '23:59', 'MIGRATION 56', now()),
  (67, 4, 'FRIO', 14, 'GUARAI', 'RSE9G60', 'ANDERSON JUNIOR ALVES LIMA', 'MARCOS ROBERTO TIMOTEO DE LIMA', NULL, 0, '23:59', 'MIGRATION 56', now()),
  (68, 4, 'FRIO', 15, 'ARAGUAINA CENTRO', 'TVD0F56', 'JEREMIAS FRANCA SOUSA', 'KAUAN / DOUGLAS ALEXANDRE', NULL, 0, '23:59', 'MIGRATION 56', now()),
  (69, 4, 'FRIO', 16, 'ARAGUAINA MARACANÃ', 'TVD1E68', 'RICARDO BATISTA FREITAS', 'RENIO / LUCAS GOMES', NULL, 0, '23:59', 'MIGRATION 56', now()),
  (70, 4, 'FRIO', 17, 'REDE - CAMPELO', 'QWA2318', 'GILCIMAR GOMES BARROS', 'RAIMUNDO NONATO / ALMIR', NULL, 0, '23:59', 'MIGRATION 56', now()),
  (71, 4, 'FRIO', 18, 'COLMÉIA', 'TVA8I23', 'LINDURVAN ALENCAR DE SOUSA', 'JOAO MARCOS SANTOS OLIVEIRA', NULL, 1, '23:59', 'MIGRATION 56', now()),
  (72, 4, 'FRIO', 19, 'SANTA FE', 'TVA8I14', 'JOAO EVANGELISTA FAUSTINO DA SILVA', 'NATAL DOS REIS', NULL, 0, '23:59', 'MIGRATION 56', now()),
  (73, 4, 'FRIO', 20, 'AÇAILANDIA', 'RSE9G00', 'JHONATAN SILVA DOS SANTOS', 'JOSE LEANDRO DA SILVA CHAVES', NULL, 0, '23:59', 'MIGRATION 56', now()),
  (74, 4, 'FRIO', 21, 'ELDORADO E PARAUAPEBAS', 'RMC7H61', 'LUCIO RODRIGUES BOTELHO', 'LUCAS CARLOS DA ROCHA', NULL, 1, '23:59', 'MIGRATION 56', now()),
  (75, 4, 'FRIO', 22, 'CANAÃ', 'RSC8G18', 'GLEISON RODRIGUES DIAS', 'RAIMUNDO DA SILVA RIBEIRO', NULL, 1, '23:59', 'MIGRATION 56', now()),
  (76, 4, 'FRIO', 23, 'SÃO GERALDO', 'RSE9H70', 'PAULO DOS SANTOS RIBEIRO', 'JOSE PAIXAO COELHO DA SILVA', NULL, 0, '23:59', 'MIGRATION 56', now()),
  (77, 4, 'SECO', 24, 'SECO - ARAGUAINA', 'RSC0C13', 'FABRICIO GOMES FERREIRA', 'EDUARDO MEDANHA DO SANTOS', NULL, 0, '23:59', 'MIGRATION 56', now()),
  (78, 4, 'SECO', 25, 'SECO - CENTRO SUL', 'RSB4G64', 'ELINALDO FERREIRA DE SOUZA', 'GUSTAVO COSTA DA SILVA', NULL, 0, '23:59', 'MIGRATION 56', now()),
  (79, 5, 'FRIO', 1, 'AXIXÁ', 'TVA8I14', 'JOAO EVANGELISTA FAUSTINO DA SILVA', 'NATAL DOS REIS', NULL, 0, '23:59', 'MIGRATION 56', now()),
  (80, 5, 'FRIO', 2, 'PALMAS NORTE', 'OLI2E18', 'EDSON VELOSO MENDES', 'MARISON DA CRUZ LIMA SANTOS', 'ARMANDO - RSC7E69', 0, '23:59', 'MIGRATION 56', now()),
  (81, 5, 'FRIO', 3, 'PALMAS SUL', 'OLH8E48', 'EDIMAR MONTELO DE FREITAS', 'LUIZ MIGUEL / ALISON', NULL, 0, '23:59', 'MIGRATION 56', now()),
  (82, 5, 'FRIO', 4, 'TAQUARALTO', 'OLI2E91', 'DIOGO COIMBRA DA SILVA', 'WILLIAM MELQUIADES DE SANTANA', NULL, 0, '23:59', 'MIGRATION 56', now()),
  (83, 5, 'FRIO', 5, 'PARAÍSO DO TOCANTINS', 'OLI0E88', 'WENNEM RUDEMBERG CASTRO DOS SANTOS', 'GUILHERME DE OLIVEIRA RAMALHO', NULL, 0, '23:59', 'MIGRATION 56', now()),
  (84, 5, 'FRIO', 6, 'PORTO NACIONAL', 'RMC7H05', 'RAIMUNDO CAVALCANTE SILVA FILHO', 'JEFERSON ALVES DA SILVA', 'DIOGENES - RMC7H05', 0, '23:59', 'MIGRATION 56', now()),
  (85, 5, 'FRIO', 7, 'COLINAS', 'RSD6G99', 'RENATO DIAS PEREIRA', 'RENATO DOS REIS ALVES', NULL, 0, '23:59', 'MIGRATION 56', now()),
  (86, 5, 'FRIO', 8, 'COLINAS 02', 'RSE9G33', 'LINDURVAN ALENCAR DE SOUSA', 'MARCOS VINICIUS FARIAS DE SOUS', NULL, 0, '23:59', 'MIGRATION 56', now()),
  (87, 5, 'FRIO', 9, 'TOCANTINÓPOLIS', 'RSE9H43', 'JEFERSON ALVES VERA', 'EDSON DOS SANTOS SILVA', NULL, 0, '23:59', 'MIGRATION 56', now()),
  (88, 5, 'FRIO', 10, 'ARAGUAINA CENTRO', 'TVD1E68', 'RICARDO BATISTA FREITAS', 'KAUAN / ALMIR', NULL, 0, '23:59', 'MIGRATION 56', now()),
  (89, 5, 'FRIO', 11, 'ARAGUAINA MARACANÃ', 'RSE9G60', 'FRANCISCO JUNIOR DE FREITAS', 'JOAO MARCOS / RENIO', NULL, 0, '23:59', 'MIGRATION 56', now()),
  (90, 5, 'FRIO', 12, 'ARAGUAINA III', 'QWA2318', 'NILVAN OLIVEIRA DE SOUSA', 'GUSTAVO / RAIMUNDO NONATO', NULL, 0, '23:59', 'MIGRATION 56', now()),
  (91, 5, 'SECO', 13, 'SECO - ARAGUAINA', 'RSC0C13', 'DHANIEL MACIEL SALES', 'EDUARDO M/ DOUGLAS ALEXANDRE', NULL, 0, '23:59', 'MIGRATION 56', now()),
  (92, 6, 'FRIO', 1, 'ARAGUAINA CENTRO', 'TVD1E68', 'RICARDO BATISTA FREITAS', 'KAUAN CLARINDO DE SOUSA SILVA', NULL, 0, '23:59', 'MIGRATION 56', now()),
  (93, 6, 'FRIO', 2, 'ARAGUAINA MARACANÃ', 'QWA2318', 'FRANCISCO JUNIOR DE FREITAS', 'EDSON DOS SANTOS SILVA', NULL, 0, '23:59', 'MIGRATION 56', now()),
  (94, 6, 'FRIO', 3, 'ARAGUAINA III', 'RSE9G23', 'FELIX AVELINO DE BRITO GUIDA', 'MARCOS ROBERTO TIMOTEO DE LIMA', NULL, 0, '23:59', 'MIGRATION 56', now())
ON CONFLICT (id) DO NOTHING;
-- A 3a feira da planilha tem o bloco Seco sem o título: rota SECO é sempre do setor SECO.
UPDATE escala_matrizes SET setor = 'SECO' WHERE rota LIKE 'SECO%' AND setor <> 'SECO';
