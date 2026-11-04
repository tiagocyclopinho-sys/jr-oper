-- =============================================================================
-- MIGRATION 54 — MOTOR OCIOSO DO POWER BI (CCO) (26/10/2026)
--
-- O que e:
--   * cco_motor_ocioso  alertas de motor ocioso do rastreador (tabela fMoov do
--                       modelo "CCO", workspace LOGISTICA), com o motorista que
--                       o Power BI liga pela viagem (vazio = sem vinculo)
--   * cco_sync_log      historico de cada sincronizacao
--   * Edge Function sync-cco (supabase/functions/sync-cco) le o Power BI com
--     o mesmo app "JR-Oper Sync" e o mesmo token do agendador da
--     produtividade (prod_sync_token).
--   * pg_cron 'cco-sync-powerbi' as 06:10 e 13:10 (Brasilia).
--
-- Regras:
--   * A cada sincronizacao, os dias do mes de fechamento atual e do anterior
--     (desde o dia 26 de dois meses atras) sao apagados e gravados de novo
--     (o vinculo com o motorista pode mudar quando a viagem e corrigida).
--   * O app (anon) so LE estas tabelas; gravar e exclusivo da Edge Function.
--   * Isencao de alertas (ex.: falha mecanica) continua manual na planilha.
-- =============================================================================

create table if not exists public.cco_motor_ocioso (
  veiculo        text not null,
  data           date not null,
  hora           time not null,
  regra          text not null default '',
  qtd            int  not null default 1,   -- linhas identicas no Power BI (o relatorio conta todas)
  numero_str     text,
  motorista      text,
  status_vinculo text,
  latitude       numeric,
  longitude      numeric,
  atualizado_em  timestamptz not null default now(),
  primary key (veiculo, data, hora, regra)
);
alter table public.cco_motor_ocioso add column if not exists qtd int not null default 1;
create index if not exists cco_motor_ocioso_data_idx on public.cco_motor_ocioso (data);

create table if not exists public.cco_sync_log (
  id            bigint generated always as identity primary key,
  iniciado_em   timestamptz not null default now(),
  finalizado_em timestamptz,
  status        text not null default 'rodando',
  de            date,
  ate           date,
  linhas        int,
  erro          text
);

alter table public.cco_motor_ocioso enable row level security;
alter table public.cco_sync_log     enable row level security;

-- Somente leitura para o app
revoke all on public.cco_motor_ocioso, public.cco_sync_log from anon, authenticated;
grant select on public.cco_motor_ocioso, public.cco_sync_log to anon;
drop policy if exists "leitura_app" on public.cco_motor_ocioso;
create policy "leitura_app" on public.cco_motor_ocioso for select to anon using (true);
drop policy if exists "leitura_app" on public.cco_sync_log;
create policy "leitura_app" on public.cco_sync_log     for select to anon using (true);

-- Agendamento: 06:10 e 13:10 de Brasilia (09:10 e 16:10 UTC), logo depois da produtividade
select cron.unschedule('cco-sync-powerbi') where exists (select 1 from cron.job where jobname = 'cco-sync-powerbi');
select cron.schedule('cco-sync-powerbi', '10 9,16 * * *', $job$
  select net.http_post(
    url := 'https://qxipgnkdbzxtfvuyupow.supabase.co/functions/v1/sync-cco',
    headers := jsonb_build_object('Content-Type','application/json',
               'x-sync-token', (select decrypted_secret from vault.decrypted_secrets where name = 'prod_sync_token')),
    body := '{}'::jsonb, timeout_milliseconds := 120000);
$job$);
