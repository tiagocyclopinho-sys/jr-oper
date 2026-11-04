-- =============================================================================
-- MIGRATION 72 - vo_sac_indicadores: Taxa de Completude para a Visao Operacao (04/11/2026)
-- =============================================================================
-- Mesma regra do cartao "Taxa de Completude" do Dashboard Executivo: mede so a ABERTURA no
-- SAC. Campos da abertura preenchidos e pelo menos 1 foto, video ou anexo de NF. Fica no
-- banco porque a tela le a nuvem direto e as colunas de midia nao precisam sair: aqui saem
-- so id, data e o resultado. faltando lista o que impede a ocorrencia de ficar completa.
-- =============================================================================

create or replace view public.vo_sac_indicadores as
with b as (
  select o.*,
    (select m.nome from public.motoristas m where m.id::text = coalesce(c.motorista_id::text, o.motorista_id::text) limit 1) as mot_nome,
    coalesce(
      (select v.placa from public.veiculos v where v.id::text = o.veiculo_id::text limit 1),
      (select v.placa from public.veiculos v where v.id::text = c.veiculo_id::text limit 1),
      o.veiculo_placa) as placa,
    coalesce(o.nf_paths::text, '[]') not in ('[]', 'null') as tem_nf_anexo
  from public.ocorrencias_devolucao o
  left join public.cargas c on c.id::text = o.carga_id::text
  where coalesce(o.is_deleted, false) = false
), f as (
  select b.id, b.criado_em, array_remove(array[
    case when b.cliente_id is null and nullif(b.cliente_nome, '') is null then 'Cliente' end,
    case when nullif(trim(b.nota_fiscal), '') is null and not b.tem_nf_anexo then 'Nota fiscal' end,
    case when coalesce(b.valor_reclamado, 0) <= 0 then 'Valor reclamado' end,
    case when nullif(trim(b.motivo_reclamado), '') is null then 'Motivo reclamado' end,
    case when coalesce(nullif(trim(b.mot_nome), ''), 'N/A') = 'N/A' then 'Motorista' end,
    case when coalesce(nullif(trim(b.placa), ''), 'N/A') = 'N/A' then 'Veículo' end,
    case when not (
      nullif(b.foto_url, '') is not null or nullif(b.video_url, '') is not null or b.tem_nf_anexo
      or coalesce(b.fotos_abertura::text, '[]') not in ('[]', 'null')
      or coalesce(b.videos_abertura::text, '[]') not in ('[]', 'null')
      or coalesce(b.fotos_abertura_paths::text, '[]') not in ('[]', 'null')
    ) then 'Foto, vídeo ou NF' end
  ], null) as faltando
  from b
)
select f.id, f.criado_em, cardinality(f.faltando) = 0 as completa, f.faltando from f;

revoke all on public.vo_sac_indicadores from anon, authenticated;
grant select on public.vo_sac_indicadores to anon;
