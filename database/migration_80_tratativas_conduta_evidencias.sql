-- =============================================================================
-- Migration 80 (v7.5.0, 17/11/2026) - TRATATIVAS POR AREA E EVIDENCIAS
--
-- Pedido do Tiago em 17/11: a Ocorrencia em Rota so tinha retorno da
-- MANUTENCAO, e a ROT-2026-028 (conduta, distrato do motorista) teve a
-- decisao do Victor Hugo gravada como "servico realizado / peca trocada".
-- A Ocorrencia Operacional nao aceitava foto nenhuma.
--
-- 1. `tratativas` (JSONB, lista) nas duas tabelas. Hoje so existe a area
--    GESTOR (conduta / desvio de rota): nasce PENDENTE e cai na fila
--    Tratativas do Gestor -> Condutas. A manutencao CONTINUA nas colunas
--    retorno_manutencao_* (Power BI, relatorios e a OS leem de la). Area nova
--    vira item da lista, nao migration nova.
--    Item: { id, area, status PENDENTE|CONCLUIDA, enviado_em, enviado_por,
--            origem AUTOMATICA|MANUAL|MIGRACAO, medida, parecer, responsavel,
--            concluida_em }. enviado_em e o relogio do SLA do gestor (24h/48h);
--            editar o relato nao zera.
-- 2. Evidencias da Ocorrencia Operacional: fotos_paths / fotos_pendentes,
--    no bucket rota-fotos, pasta ocoper/ (policies do bucket sao por
--    bucket_id, nao precisa policy nova).
-- 3. Anexo da tratativa do gestor (documento assinado, foto da prova) nas
--    duas tabelas: tratativa_fotos_paths / tratativa_fotos_pendentes.
-- 4. Dados: ROT-2026-028 tem o retorno do Victor Hugo movido para uma
--    tratativa do gestor (medida DISTRATO) e o retorno de manutencao limpo.
--    As 3 ocorrencias operacionais de conduta/desvio ainda abertas entram na
--    fila do gestor com enviado_em = criado_em.
--
-- ocorrencias_rota e ocorrencias_viagens sobem SEM lista branca: as colunas
-- tem de existir ANTES do deploy da 7.5.0, senao o lote cai com PGRST204.
-- =============================================================================

alter table ocorrencias_rota    add column if not exists tratativas jsonb default '[]'::jsonb;
alter table ocorrencias_rota    add column if not exists tratativa_fotos_paths jsonb default '[]'::jsonb;
alter table ocorrencias_rota    add column if not exists tratativa_fotos_pendentes integer default 0;

alter table ocorrencias_viagens add column if not exists tratativas jsonb default '[]'::jsonb;
alter table ocorrencias_viagens add column if not exists fotos_paths jsonb default '[]'::jsonb;
alter table ocorrencias_viagens add column if not exists fotos_pendentes integer default 0;
alter table ocorrencias_viagens add column if not exists tratativa_fotos_paths jsonb default '[]'::jsonb;
alter table ocorrencias_viagens add column if not exists tratativa_fotos_pendentes integer default 0;

comment on column ocorrencias_rota.tratativas is
  'Tratativas por area (lista). Hoje: GESTOR (conduta). A manutencao segue em retorno_manutencao_*. Migration 80.';
comment on column ocorrencias_viagens.tratativas is
  'Tratativas por area (lista). Hoje: GESTOR (conduta / desvio de rota). Migration 80.';
comment on column ocorrencias_viagens.fotos_paths is
  'Evidencias da ocorrencia operacional: caminhos no bucket rota-fotos (pasta ocoper/). Migration 80.';

-- ROT-2026-028: a decisao do gestor sai do retorno de manutencao.
update ocorrencias_rota
   set tratativas = jsonb_build_array(jsonb_build_object(
         'id', 'trat_mig80_rot028',
         'area', 'GESTOR',
         'status', 'CONCLUIDA',
         'origem', 'MIGRACAO',
         'enviado_em', to_char(criado_em, 'YYYY-MM-DD"T"HH24:MI:SS') || '-03:00',
         'enviado_por', 'MIGRACAO 80',
         'medida', 'DISTRATO',
         'parecer', retorno_manutencao_descricao,
         'responsavel', retorno_manutencao_responsavel,
         'concluida_em', to_char(retorno_manutencao_data, 'YYYY-MM-DD"T"HH24:MI:SS') || '-03:00')),
       retorno_manutencao_descricao = '',
       retorno_manutencao_responsavel = null,
       retorno_manutencao_data = null,
       acao_mecanico = '',
       atualizado_em = now(),
       atualizado_por = 'MIGRACAO 80'
 where numero_protocolo = 'ROT-2026-028'
   and coalesce(jsonb_array_length(tratativas), 0) = 0
   and retorno_manutencao_descricao ilike '%DISTRATO%';

-- Condutas/desvios operacionais ainda abertos vao para a fila do gestor.
update ocorrencias_viagens
   set tratativas = jsonb_build_array(jsonb_build_object(
         'id', 'trat_mig80_' || id,
         'area', 'GESTOR',
         'status', 'PENDENTE',
         'origem', 'MIGRACAO',
         'enviado_em', to_char(criado_em, 'YYYY-MM-DD"T"HH24:MI:SS') || '-03:00',
         'enviado_por', 'MIGRACAO 80')),
       status = 'PENDENTE',
       atualizado_em = now()
 where not coalesce(is_deleted, false)
   and (motivo ilike '%CONDUTA%' or motivo ilike '%DESVIO%')
   and coalesce(status, '') <> 'FINALIZADA'
   and coalesce(jsonb_array_length(tratativas), 0) = 0;

-- Conferencia:
-- select numero_protocolo, tratativas, retorno_manutencao_descricao from ocorrencias_rota where numero_protocolo = 'ROT-2026-028';
-- select id, funcionario, motivo, status, tratativas from ocorrencias_viagens where jsonb_array_length(tratativas) > 0;
