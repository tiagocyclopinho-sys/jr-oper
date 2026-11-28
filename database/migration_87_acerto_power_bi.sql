-- =============================================================================
-- Migration 87 - Acerto de motoristas: dados do Power BI (28/11/2026)
--
-- Copia do modelo "Motorista e Ajudantes" (workspace LOGISTICA) o que o acerto
-- precisa, pela Edge Function sync-acerto (pg_cron 06h30 e 13h30):
--   * acerto_pbi_cargas   f_MOTORISTA (PCCARREG): uma linha por carregamento,
--                         com motorista, ajudantes (1/2/3), motorista e ajudante
--                         do transbordo, peso, entregas, rota principal, data de
--                         saida (= data da carga no WinThor, que define o mes) e
--                         de faturamento. So conta carga FATURADA e nao cancelada.
--   * acerto_pbi_compras  f_MOTORISTA ent (PCNFENT): frete de compra. Ligado ao
--                         motorista pelo CPF DENTRO do Power BI (o CPF nao sai de
--                         la: vem so a matricula). Mes pela data de entrada.
--   * acerto_pbi_rotas    aux_ROTA (codigo e descricao da rota do WinThor).
--   * acerto_sync_log     uma linha por execucao.
-- Codigo do motorista/ajudante no WinThor = id do cadastro do JR-Oper.
-- Conferido contra os PDFs de nov/26: 1.160 de 1.160 cargas e 60 de 62 compras
-- (NF 117518 e 117551, pagas ao Nilmar, nao estao no f_MOTORISTA ent).
-- Mesma seguranca do acerto (migration 85): RLS sem politica, sem acesso anon.
-- =============================================================================

create table if not exists public.acerto_pbi_cargas (
  numcar bigint primary key,
  dtsaida date not null,
  dtfat date,
  dtcancel date,
  codmotorista integer,
  codmot_transb integer,
  codajud1 integer,
  codajud2 integer,
  codajud3 integer,
  codajud_transb integer,
  peso numeric(14,3),
  nument integer,
  codrota integer,
  destino text,
  vltotal numeric(14,2),
  codveiculo integer,
  atualizado_em timestamptz not null default now()
);
create index if not exists acerto_pbi_cargas_dt_idx on public.acerto_pbi_cargas (dtsaida);

create table if not exists public.acerto_pbi_compras (
  chave text primary key,              -- numnota|serie|especie|codfornec (NF repete entre fornecedores)
  numnota bigint not null,
  serie text,
  especie text,
  codfornec integer,
  dtent date not null,
  matricula integer,                   -- motorista, pelo CPF da nota (feito no Power BI)
  peso numeric(14,3),
  uf text,
  atualizado_em timestamptz not null default now()
);
create index if not exists acerto_pbi_compras_dt_idx on public.acerto_pbi_compras (dtent);

create table if not exists public.acerto_pbi_rotas (
  codrota integer primary key,
  descricao text,
  atualizado_em timestamptz not null default now()
);

create table if not exists public.acerto_sync_log (
  id bigint generated always as identity primary key,
  iniciado_em timestamptz not null default now(),
  finalizado_em timestamptz,
  de date,
  ate date,
  status text not null default 'rodando',
  cargas integer,
  compras integer,
  erro text
);

alter table public.acerto_pbi_cargas enable row level security;
alter table public.acerto_pbi_compras enable row level security;
alter table public.acerto_pbi_rotas enable row level security;
alter table public.acerto_sync_log enable row level security;
revoke all on public.acerto_pbi_cargas, public.acerto_pbi_compras, public.acerto_pbi_rotas,
  public.acerto_sync_log from anon, authenticated;

-- Agendamento: 06h30 e 13h30 de Brasilia (09h30 e 16h30 UTC), depois das outras
-- sincronizacoes do Power BI. Mesmo token do Vault ('prod_sync_token').
select cron.unschedule('acerto-sync-powerbi') where exists (select 1 from cron.job where jobname = 'acerto-sync-powerbi');
select cron.schedule('acerto-sync-powerbi', '30 9,16 * * *', $$
  select net.http_post(
    url := 'https://qxipgnkdbzxtfvuyupow.supabase.co/functions/v1/sync-acerto',
    headers := jsonb_build_object('Content-Type', 'application/json',
      'x-sync-token', (select decrypted_secret from vault.decrypted_secrets where name = 'prod_sync_token')),
    body := '{}'::jsonb,
    timeout_milliseconds := 300000)
$$);
