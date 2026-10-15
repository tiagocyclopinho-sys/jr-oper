-- =============================================================================
-- MIGRATION 51 — VIEWS DE LEITURA PARA O POWER BI (14/10/2026)
--
-- Cinco views novas, uma por módulo:
--   vw_bi_devolucoes_completa   Devolução: Abertura + Monitoramento + Tratativa
--   vw_bi_controle_viagens      Controle de Viagens
--   vw_bi_ocorrencias_viagem    Oc. Operacional + Oc. em Rota (uma tabela só)
--   vw_bi_resumo_diario_cd      Resumo Diário do CD (uma linha por data+turno)
--   vw_bi_ocorrencias_cd        Ocorrências do CD
--
-- Regras comuns:
--   * Registros excluídos (is_deleted) ficam de fora.
--   * Fotos, vídeos e PDFs ficam de fora — são base64/caminhos de storage que
--     o Power BI não consome e só inflariam o import. Vai só a QUANTIDADE.
--   * Datas que o app grava como texto ('AAAA-MM-DD', 'HH:MM') saem como
--     date/timestamp; texto vazio vira NULL.
--   * security_invoker + sem acesso para anon/authenticated: a chave anon
--     está no front-end, e estas views juntam dados de várias tabelas. O
--     Power BI conecta como postgres (power_bi_guia.md), que continua lendo.
--   * Coluna nova entra SEMPRE NO FIM da view (CREATE OR REPLACE não aceita
--     coluna no meio; um DROP derruba a conexão do Power BI).
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. DEVOLUÇÕES — ABERTURA, MONITORAMENTO E TRATATIVA (uma linha por devolução)
-- -----------------------------------------------------------------------------
CREATE OR REPLACE VIEW vw_bi_devolucoes_completa WITH (security_invoker = true) AS
SELECT
    o.id,
    o.numero_protocolo,
    o.numero_devolucao,

    -- ABERTURA
    o.criado_em                                   AS aberta_em,
    o.criado_em::date                             AS data_abertura,
    u.nome                                        AS aberta_por,
    o.carga_numero,
    o.rota_nome                                   AS rota,
    o.veiculo_placa                               AS placa,
    m.nome                                        AS motorista,
    o.cliente_nome                                AS cliente,
    c.codigo_cliente,
    c.cidade                                      AS cliente_cidade,
    c.uf                                          AS cliente_uf,
    o.nota_fiscal,
    o.motivo_reclamado,
    o.valor_reclamado,
    o.detalhamento_texto                          AS detalhamento_abertura,
    o.sem_itens,
    o.observacao_sem_itens,
    o.cliente_emite_nf,
    o.forma_acerto,
    COALESCE(jsonb_array_length(CASE WHEN jsonb_typeof(o.fotos_abertura_paths) = 'array' THEN o.fotos_abertura_paths END),
             jsonb_array_length(CASE WHEN jsonb_typeof(o.fotos_abertura) = 'array' THEN o.fotos_abertura END), 0) AS qtd_fotos_abertura,
    COALESCE(jsonb_array_length(CASE WHEN jsonb_typeof(o.videos_abertura) = 'array' THEN o.videos_abertura END), 0) AS qtd_videos_abertura,
    COALESCE(jsonb_array_length(CASE WHEN jsonb_typeof(o.nf_paths) = 'array' THEN o.nf_paths END), 0) AS qtd_nf_anexadas,

    -- ITENS (itens_devolucao)
    COALESCE(i.qtd_itens, 0)                      AS qtd_itens,
    COALESCE(i.quantidade_total, 0)               AS quantidade_total_itens,
    COALESCE(i.valor_total, 0)                    AS valor_total_itens,

    -- RECEBIMENTO FÍSICO NO CD
    o.status_fechamento,
    o.data_entrada_cd,
    o.destino_cd,

    -- MONITORAMENTO
    o.responsavel_analise,
    o.motivo_real_causa_raiz,
    o.tipo_erro,
    o.tipo_erro_outro,
    o.descricao_monitoramento,
    o.separador_apurado,
    o.conferente_apurado,
    o.acao_tomada,
    COALESCE(jsonb_array_length(CASE WHEN jsonb_typeof(o.fotos_investigacao_paths) = 'array' THEN o.fotos_investigacao_paths END),
             jsonb_array_length(CASE WHEN jsonb_typeof(o.fotos_investigacao) = 'array' THEN o.fotos_investigacao END), 0) AS qtd_fotos_monitoramento,
    COALESCE(jsonb_array_length(CASE WHEN jsonb_typeof(o.videos_investigacao) = 'array' THEN o.videos_investigacao END), 0) AS qtd_videos_monitoramento,

    -- TRATATIVA (GESTOR)
    g.nome                                        AS gestor,
    o.status_gestao,
    o.acao_gestor,
    o.desconto_produtividade_gestor,
    o.data_acao_gestor,
    CASE WHEN o.data_acao_gestor IS NULL THEN NULL
         ELSE ROUND(EXTRACT(EPOCH FROM (o.data_acao_gestor - o.criado_em)) / 86400, 1) END AS dias_ate_tratativa,

    -- CONTROLE
    o.atualizado_em,
    o.atualizado_por
FROM ocorrencias_devolucao o
LEFT JOIN usuarios   u ON u.id = o.criado_por_usuario_id
LEFT JOIN usuarios   g ON g.id = o.gestor_id
LEFT JOIN motoristas m ON m.id = o.motorista_id
LEFT JOIN clientes   c ON c.id = o.cliente_id
LEFT JOIN (
    SELECT ocorrencia_devolucao_id,
           COUNT(*)                     AS qtd_itens,
           SUM(quantidade)              AS quantidade_total,
           SUM(valor_total)             AS valor_total
    FROM itens_devolucao
    WHERE COALESCE(is_deleted, FALSE) = FALSE
    GROUP BY ocorrencia_devolucao_id
) i ON i.ocorrencia_devolucao_id = o.id
WHERE COALESCE(o.is_deleted, FALSE) = FALSE;

-- -----------------------------------------------------------------------------
-- 2. CONTROLE DE VIAGENS
-- -----------------------------------------------------------------------------
CREATE OR REPLACE VIEW vw_bi_controle_viagens WITH (security_invoker = true) AS
WITH v AS (
    SELECT cv.*,
           CASE WHEN cv.data_saida   ~ '^\d{4}-\d{2}-\d{2}' THEN left(cv.data_saida, 10)::date   END AS d_saida,
           CASE WHEN cv.data_entrega ~ '^\d{4}-\d{2}-\d{2}' THEN left(cv.data_entrega, 10)::date END AS d_entrega,
           CASE WHEN cv.data_retorno ~ '^\d{4}-\d{2}-\d{2}' THEN left(cv.data_retorno, 10)::date END AS d_retorno,
           CASE WHEN cv.hora_saida   ~ '^\d{1,2}:\d{2}' THEN cv.hora_saida::time   END AS h_saida,
           CASE WHEN cv.hora_entrega ~ '^\d{1,2}:\d{2}' THEN cv.hora_entrega::time END AS h_entrega,
           CASE WHEN cv.hora_retorno ~ '^\d{1,2}:\d{2}' THEN cv.hora_retorno::time END AS h_retorno
    FROM controle_viagens cv
    WHERE COALESCE(cv.is_deleted, FALSE) = FALSE
)
SELECT
    v.id,
    v.carga,
    v.rota,
    v.placa,
    v.motorista,
    v.ajudante,
    v.ajudante_2,
    v.setor,
    v.status_viagem,
    v.fusion,
    v.checklist_saida,
    v.checklist_chegada,
    v.d_saida                                     AS data_saida,
    v.h_saida                                     AS hora_saida,
    v.d_saida + v.h_saida                         AS saida_em,
    v.d_entrega                                   AS data_entrega,
    v.h_entrega                                   AS hora_entrega,
    v.d_entrega + v.h_entrega                     AS entrega_em,
    v.d_retorno                                   AS data_retorno,
    v.h_retorno                                   AS hora_retorno,
    v.d_retorno + v.h_retorno                     AS retorno_em,
    -- Horas entre os marcos (NULL enquanto o marco final não foi lançado)
    ROUND(EXTRACT(EPOCH FROM ((v.d_entrega + v.h_entrega) - (v.d_saida + v.h_saida))) / 3600, 2)   AS horas_saida_ate_entrega,
    ROUND(EXTRACT(EPOCH FROM ((v.d_retorno + v.h_retorno) - (v.d_saida + v.h_saida))) / 3600, 2)   AS horas_viagem_total,
    v.observacao,
    v.criado_em,
    v.atualizado_em
FROM v;

-- -----------------------------------------------------------------------------
-- 3. OCORRÊNCIAS DE VIAGEM — OC. OPERACIONAL + OC. EM ROTA
--    "origem" separa as duas. Colunas que só existem na Oc. em Rota (socorro,
--    mecânico, guincho...) vêm NULL nas linhas de Oc. Operacional.
--    Oc. em Rota não tem data própria: usa a data do chamado (criado_em).
-- -----------------------------------------------------------------------------
CREATE OR REPLACE VIEW vw_bi_ocorrencias_viagem WITH (security_invoker = true) AS
SELECT
    'OPERACIONAL'::varchar                        AS origem,
    ov.id,
    NULL::varchar                                 AS numero_protocolo,
    CASE WHEN ov.data ~ '^\d{4}-\d{2}-\d{2}' THEN left(ov.data, 10)::date END AS data,
    ov.carga,
    ov.rota,
    ov.placa,
    ov.funcionario,
    ov.funcao,
    ov.motivo,
    ov.ocorrencia                                 AS descricao,
    ov.causa,
    ov.acao,
    ov.status,
    NULL::text                                    AS localizacao,
    NULL::boolean                                 AS veiculo_parado,
    NULL::varchar                                 AS status_veiculo,
    NULL::boolean                                 AS guincho_acionado,
    NULL::numeric                                 AS custo_socorro,
    NULL::varchar                                 AS mecanico_responsavel,
    NULL::text                                    AS pecas_trocadas,
    NULL::text                                    AS retorno_manutencao_descricao,
    NULL::timestamp                               AS retorno_manutencao_data,
    NULL::timestamp                               AS resolvido_em,
    NULL::numeric                                 AS horas_ate_resolver,
    NULL::varchar                                 AS criado_por,
    ov.criado_em,
    ov.atualizado_em
FROM ocorrencias_viagens ov
WHERE COALESCE(ov.is_deleted, FALSE) = FALSE

UNION ALL

SELECT
    'EM ROTA'::varchar,
    r.id,
    r.numero_protocolo,
    r.criado_em::date,
    r.carga_numero,
    r.rota_nome,
    COALESCE(r.veiculo_placa, ve.placa),
    COALESCE(r.motorista_nome, mo.nome),
    'MOTORISTA'::varchar,
    COALESCE(NULLIF(r.motivo_resumido, ''), r.tipo_ocorrencia),
    r.descricao,
    r.tipo_ocorrencia,
    r.acao_mecanico,
    COALESCE(NULLIF(r.status_chamado, ''), r.status),
    r.localizacao,
    r.veiculo_parado,
    r.status_veiculo,
    r.guincho_acionado,
    r.custo_socorro,
    me.nome,
    r.pecas_trocadas,
    r.retorno_manutencao_descricao,
    r.retorno_manutencao_data,
    r.resolvido_em,
    CASE WHEN r.resolvido_em IS NULL THEN NULL
         ELSE ROUND(EXTRACT(EPOCH FROM (r.resolvido_em - r.criado_em)) / 3600, 2) END,
    r.criado_por,
    r.criado_em,
    r.atualizado_em
FROM ocorrencias_rota r
LEFT JOIN veiculos   ve ON ve.id = r.veiculo_id
LEFT JOIN motoristas mo ON mo.id = r.motorista_id
LEFT JOIN usuarios   me ON me.id = r.mecanico_responsavel_id
WHERE COALESCE(r.is_deleted, FALSE) = FALSE;

-- -----------------------------------------------------------------------------
-- 4. RESUMO DIÁRIO DO CD (uma linha por data + turno)
--    Movimentação sai do JSON; ocorrências, ocorrências de colaborador e cortes
--    saem das tabelas-filhas (fonte oficial desde a 6.7.0 / migration 44).
-- -----------------------------------------------------------------------------
CREATE OR REPLACE VIEW vw_bi_resumo_diario_cd WITH (security_invoker = true) AS
SELECT
    r.id,
    r.data,
    r.turno,
    r.gestor,

    -- EXPEDIÇÃO
    NULLIF(r.movimentacao #>> '{expedicao,peso}', '')::numeric              AS exp_peso_kg,
    NULLIF(r.movimentacao #>> '{expedicao,cargas_previstas}', '')::numeric  AS exp_cargas_previstas,
    NULLIF(r.movimentacao #>> '{expedicao,cargas_realizadas}', '')::numeric AS exp_cargas_realizadas,
    NULLIF(r.movimentacao #>> '{expedicao,cargas_veiculos}', '')::numeric   AS exp_veiculos,
    NULLIF(r.movimentacao #>> '{expedicao,conferente}', '')::numeric        AS exp_conferentes,
    NULLIF(r.movimentacao #>> '{expedicao,movimentador}', '')::numeric      AS exp_movimentadores,
    NULLIF(r.movimentacao #>> '{expedicao,empilhador}', '')::numeric        AS exp_empilhadores,
    NULLIF(r.movimentacao #>> '{expedicao,aux_junior}', '')::numeric        AS exp_aux_junior,

    -- RECEBIMENTO
    NULLIF(r.movimentacao #>> '{recebimento,peso}', '')::numeric              AS rec_peso_kg,
    NULLIF(r.movimentacao #>> '{recebimento,cargas_previstas}', '')::numeric  AS rec_cargas_previstas,
    NULLIF(r.movimentacao #>> '{recebimento,cargas_realizadas}', '')::numeric AS rec_cargas_realizadas,
    NULLIF(r.movimentacao #>> '{recebimento,cargas_veiculos}', '')::numeric   AS rec_veiculos,
    NULLIF(r.movimentacao #>> '{recebimento,conferente}', '')::numeric        AS rec_conferentes,
    NULLIF(r.movimentacao #>> '{recebimento,movimentador}', '')::numeric      AS rec_movimentadores,
    NULLIF(r.movimentacao #>> '{recebimento,empilhador}', '')::numeric        AS rec_empilhadores,
    NULLIF(r.movimentacao #>> '{recebimento,aux_junior}', '')::numeric        AS rec_aux_junior,

    -- FALTAS E CONDUTAS (JSON do próprio resumo)
    COALESCE(jsonb_array_length(CASE WHEN jsonb_typeof(r.faltas_condutas) = 'array' THEN r.faltas_condutas END), 0) AS qtd_faltas_condutas,

    -- TABELAS-FILHAS
    (SELECT COUNT(*) FROM ocorrencias_cd oc
      WHERE oc.data = r.data AND oc.turno = r.turno AND COALESCE(oc.is_deleted, FALSE) = FALSE)       AS qtd_ocorrencias_cd,
    (SELECT COUNT(*) FROM ocorrencias_colaborador ok
      WHERE ok.data = r.data AND ok.turno = r.turno AND COALESCE(ok.is_deleted, FALSE) = FALSE)       AS qtd_ocorrencias_colaborador,
    (SELECT COUNT(*) FROM cortes_cd ct
      WHERE ct.data = r.data AND ct.turno = r.turno AND COALESCE(ct.is_deleted, FALSE) = FALSE)       AS qtd_cortes,
    (SELECT COALESCE(SUM(ct.valor), 0) FROM cortes_cd ct
      WHERE ct.data = r.data AND ct.turno = r.turno AND COALESCE(ct.is_deleted, FALSE) = FALSE)       AS valor_cortes,

    r.atualizado_em
FROM resumo_diario_cd r
WHERE COALESCE(r.is_deleted, FALSE) = FALSE;

-- -----------------------------------------------------------------------------
-- 5. OCORRÊNCIAS DO CD
-- -----------------------------------------------------------------------------
CREATE OR REPLACE VIEW vw_bi_ocorrencias_cd WITH (security_invoker = true) AS
SELECT
    oc.id,
    oc.data,
    oc.turno,
    oc.gestor,
    oc.ocorrencia,
    oc.causa,
    oc.acao,
    oc.criado_por,
    oc.criado_em,
    oc.atualizado_em
FROM ocorrencias_cd oc
WHERE COALESCE(oc.is_deleted, FALSE) = FALSE;

-- -----------------------------------------------------------------------------
-- ACESSO: só postgres/service_role (Power BI). Fora da API pública.
-- -----------------------------------------------------------------------------
REVOKE ALL ON vw_bi_devolucoes_completa, vw_bi_controle_viagens, vw_bi_ocorrencias_viagem,
              vw_bi_resumo_diario_cd, vw_bi_ocorrencias_cd
    FROM anon, authenticated;
