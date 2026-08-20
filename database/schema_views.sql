-- =============================================================================
-- VIEWS OTIMIZADAS PARA POWER BI - SISTEMA JR SAC & LOGÍSTICA CORPORATIVA
-- =============================================================================
-- IMPORTANTE: rode este arquivo DEPOIS de database/schema.sql ter rodado com
-- sucesso (Query 2, depois da Query 1). As views abaixo dependem de colunas
-- de várias tabelas (usuarios.id, ocorrencias_devolucao.id, cargas.id,
-- veiculos.id, motoristas.id, clientes.id, produtos.id, retencoes_frota.*
-- etc.) — se alguma dessas tabelas ainda não existir, ou se o schema.sql
-- ainda não tiver terminado de ajustar o tipo dessas colunas, a criação da
-- view falha, e alterar o tipo de uma coluna que uma view já usa também
-- falha (erro "cannot alter type of a column used by a view or rule").
-- Rodar em queries separadas, nessa ordem, evita esse problema de vez.
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
