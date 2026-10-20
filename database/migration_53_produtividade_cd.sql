-- =============================================================================
-- MIGRATION 53 — PRODUTIVIDADE CD: PONTOS DO POWER BI (20/10/2026)
--
-- JA APLICADA NA PRODUCAO (migrations prod_01_sync_powerbi,
-- prod_02_agendamento_e_congela_set26 e prod_03_leitura_app). Este arquivo e o
-- registro do que foi feito; pode ser rodado de novo sem estragar nada.
--
-- O que e:
--   * prod_periodos    meses de fechamento (26 do mes anterior a 25 do mes) e
--                      status: aberto (previa, atualiza) | fechado | publicado
--                      (congelados — o Power BI recalcula o passado com o
--                      cadastro de hoje, entao mes fechado NUNCA e re-sincronizado)
--   * prod_pontuacao   pontuacao e producao por matricula do WMS e mes
--   * prod_sync_log    historico de cada sincronizacao
--   * Edge Function sync-produtividade (supabase/functions/sync-produtividade)
--     le o modelo "Produtividade" do Power BI com o app "JR-Oper Sync"
--     (service principal) e grava aqui. Segredos PBI_CLIENT_ID e
--     PBI_CLIENT_SECRET nos Secrets das Edge Functions.
--   * pg_cron 'prod-sync-powerbi' as 06:00 e 13:00 (Brasilia).
--
-- Regras:
--   * O app (anon) so LE estas tabelas; gravar e exclusivo da Edge Function.
--   * Nada de valores em R$ (decisao de 20/10/2026): so pontos, producao e
--     ocorrencias.
-- =============================================================================

create extension if not exists pg_net;
create extension if not exists pg_cron;

create table if not exists public.prod_periodos (
  ano_mes       int primary key,
  rotulo        text not null,
  inicio        date not null,
  fim           date not null,
  status        text not null default 'aberto'
                check (status in ('aberto','fechado','publicado')),
  atualizado_em timestamptz not null default now()
);

create table if not exists public.prod_pontuacao (
  ano_mes       int  not null references public.prod_periodos(ano_mes),
  matricula     text not null,
  nome          text,
  cargo         text,
  setor         text,
  pontuacao     numeric,
  qtd_os        numeric,
  qtd_apanhos   numeric,
  kg_total      numeric,
  kg_entrada    numeric,
  kg_carne      numeric,
  atualizado_em timestamptz not null default now(),
  primary key (ano_mes, matricula)
);

create table if not exists public.prod_sync_log (
  id                    bigint generated always as identity primary key,
  iniciado_em           timestamptz not null default now(),
  finalizado_em         timestamptz,
  status                text not null default 'rodando',
  meses                 int[],
  linhas                int,
  linhas_sem_matricula  int,
  erro                  text
);

alter table public.prod_periodos  enable row level security;
alter table public.prod_pontuacao enable row level security;
alter table public.prod_sync_log  enable row level security;

-- Somente leitura para o app
revoke all on public.prod_periodos, public.prod_pontuacao, public.prod_sync_log from anon, authenticated;
grant select on public.prod_periodos, public.prod_pontuacao, public.prod_sync_log to anon;
drop policy if exists "leitura_app" on public.prod_periodos;
create policy "leitura_app" on public.prod_periodos  for select to anon using (true);
drop policy if exists "leitura_app" on public.prod_pontuacao;
create policy "leitura_app" on public.prod_pontuacao for select to anon using (true);
drop policy if exists "leitura_app" on public.prod_sync_log;
create policy "leitura_app" on public.prod_sync_log  for select to anon using (true);

create or replace view public.prod_periodos_resumo with (security_invoker = on) as
select p.ano_mes, p.rotulo, p.inicio, p.fim, p.status,
       (select count(*) from public.prod_pontuacao x where x.ano_mes = p.ano_mes) as colaboradores
from public.prod_periodos p;
grant select on public.prod_periodos_resumo to anon;

-- Token interno do agendador (gerado aqui, guardado no Vault)
do $$
begin
  if not exists (select 1 from vault.secrets where name = 'prod_sync_token') then
    perform vault.create_secret(encode(extensions.gen_random_bytes(32), 'hex'), 'prod_sync_token',
                                'Token do agendador da sincronizacao de produtividade');
  end if;
end $$;

create or replace function public.prod_sync_token_ok(p_token text)
returns boolean
language sql
security definer
set search_path = ''
as $$
  select exists (select 1 from vault.decrypted_secrets
                 where name = 'prod_sync_token' and decrypted_secret = p_token);
$$;
revoke execute on function public.prod_sync_token_ok(text) from public, anon, authenticated;
grant  execute on function public.prod_sync_token_ok(text) to service_role;

-- Agendamento: 06:00 e 13:00 de Brasilia (09:00 e 16:00 UTC)
select cron.unschedule('prod-sync-powerbi') where exists (select 1 from cron.job where jobname = 'prod-sync-powerbi');
select cron.schedule('prod-sync-powerbi', '0 9,16 * * *', $job$
  select net.http_post(
    url := 'https://qxipgnkdbzxtfvuyupow.supabase.co/functions/v1/sync-produtividade',
    headers := jsonb_build_object('Content-Type','application/json',
               'x-sync-token', (select decrypted_secret from vault.decrypted_secrets where name = 'prod_sync_token')),
    body := '{}'::jsonb, timeout_milliseconds := 90000);
$job$);

-- Para fechar um mes (congelar):
--   update public.prod_periodos set status = 'fechado', atualizado_em = now() where ano_mes = 202610;
