-- =============================================================================
-- MIGRATION 55 — FOTO MENSAL DA "VISÃO OPERAÇÃO" (28/10/2026)
--
-- O que e:
--   * vo_periodos     um mes de referencia (AAAAMM) por linha: 'aberto' (previa,
--                     muda a cada sincronizacao) ou 'fechado' (congelado)
--   * vo_indicadores  numeros de cabecalho de cada secao (ex.: devolucao/valor)
--   * vo_quadros      linhas dos graficos/tabelas (ex.: devolucao/motivo/ERRO RCA)
--   * vo_sync_log     historico de cada sincronizacao
--   * Edge Function sync-visao-operacao (supabase/functions/sync-visao-operacao)
--     le o Power BI (workspace LOGISTICA) com o app "JR-Oper Sync" e o mesmo
--     token do agendador da produtividade (prod_sync_token).
--   * pg_cron 'vo-sync-powerbi' as 06:20 (Brasilia).
--
-- Regras:
--   * Mes de referencia M: secoes 26->25 (cortes) vao de 26/(M-1) a 25/M;
--     secoes de mes cheio (devolucao, despesa, abastecimento, motoristas,
--     rastreamento) vao de 01/M ao ultimo dia; inventario e acumulado do ano.
--   * O mes M e congelado a partir do dia 3 de M+1 (o mesmo dia em que a
--     apresentacao e montada hoje). Depois disso so muda vo_indicadores.valor_atual
--     (lancamentos que chegam depois, ex.: notas quinzenais de abastecimento),
--     para a apresentacao seguinte mostrar o ajuste.
--   * Hora Extra NAO entra (fica em outro perfil, por ter valores de folha).
--   * O app (anon) so LE estas tabelas; gravar e exclusivo da Edge Function.
-- =============================================================================

create table if not exists public.vo_periodos (
  ano_mes       int primary key,               -- AAAAMM
  status        text not null default 'aberto' check (status in ('aberto', 'fechado')),
  congelado_em  timestamptz,
  atualizado_em timestamptz not null default now()
);

create table if not exists public.vo_indicadores (
  ano_mes       int  not null,
  secao         text not null,
  indicador     text not null,
  valor         numeric,                       -- valor do fechamento (congelado)
  valor_atual   numeric,                       -- mesmo calculo hoje (so muda depois de congelado)
  de            date,
  ate           date,
  atualizado_em timestamptz not null default now(),
  primary key (ano_mes, secao, indicador)
);

create table if not exists public.vo_quadros (
  ano_mes       int  not null,
  secao         text not null,
  quadro        text not null,
  rotulo        text not null,
  ordem         int  not null default 0,
  valor         numeric,
  valor2        numeric,
  valor3        numeric,
  atualizado_em timestamptz not null default now(),
  primary key (ano_mes, secao, quadro, rotulo)
);

create table if not exists public.vo_sync_log (
  id            bigint generated always as identity primary key,
  iniciado_em   timestamptz not null default now(),
  finalizado_em timestamptz,
  status        text not null default 'rodando',
  meses         text,
  detalhe       jsonb,
  erro          text
);

alter table public.vo_periodos    enable row level security;
alter table public.vo_indicadores enable row level security;
alter table public.vo_quadros     enable row level security;
alter table public.vo_sync_log    enable row level security;

-- Somente leitura para o app e para o gerador da apresentacao
revoke all on public.vo_periodos, public.vo_indicadores, public.vo_quadros, public.vo_sync_log from anon, authenticated;
grant select on public.vo_periodos, public.vo_indicadores, public.vo_quadros, public.vo_sync_log to anon;
drop policy if exists "leitura_app" on public.vo_periodos;
create policy "leitura_app" on public.vo_periodos    for select to anon using (true);
drop policy if exists "leitura_app" on public.vo_indicadores;
create policy "leitura_app" on public.vo_indicadores for select to anon using (true);
drop policy if exists "leitura_app" on public.vo_quadros;
create policy "leitura_app" on public.vo_quadros     for select to anon using (true);
drop policy if exists "leitura_app" on public.vo_sync_log;
create policy "leitura_app" on public.vo_sync_log    for select to anon using (true);

-- Agendamento: 06:20 de Brasilia (09:20 UTC), depois da produtividade e da CCO
select cron.unschedule('vo-sync-powerbi') where exists (select 1 from cron.job where jobname = 'vo-sync-powerbi');
select cron.schedule('vo-sync-powerbi', '20 9 * * *', $job$
  select net.http_post(
    url := 'https://qxipgnkdbzxtfvuyupow.supabase.co/functions/v1/sync-visao-operacao',
    headers := jsonb_build_object('Content-Type','application/json',
               'x-sync-token', (select decrypted_secret from vault.decrypted_secrets where name = 'prod_sync_token')),
    body := '{}'::jsonb, timeout_milliseconds := 150000);
$job$);
