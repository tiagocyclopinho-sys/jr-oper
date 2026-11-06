-- =============================================================================
-- Migration 73 - Custo de gestao na Visao Operacao (06/11/2026)
--
-- Indicadores pedidos pelo Tiago: combustivel e despesa de cartao sobre peso e
-- faturamento, para gerente comercial, supervisor e motorista. Mes cheio.
--
--   * vo_veiculo_responsavel  quem responde por cada carro em cada periodo. O
--     combustivel vem so da placa (modelo Abastecimento); periodo sem certeza fica
--     fora do indicador de proposito.
--   * vo_veiculo_codigo       CODVEICULO do WinThor -> placa. O modelo Motoristas
--     nao tem placa: a Edge Function aprende pelo controle_viagens (mesma carga).
--   * pg_cron vo-custo-gestao 06h40, depois da vo-sync-powerbi.
-- A Edge Function sync-custo-gestao grava em vo_indicadores / vo_quadros, secao
-- 'custo_gestao'. Mes fechado so e regravado com { "meses": [...] }.
-- =============================================================================

create table if not exists public.vo_veiculo_responsavel (
  id bigint generated always as identity primary key,
  placa text not null,
  nome text not null,          -- maiusculo, sem acento, como no Power BI
  de date not null,
  ate date,                    -- vazio = ate hoje
  observacao text,
  unique (placa, nome, de)
);

create table if not exists public.vo_veiculo_codigo (
  codveiculo text primary key,
  placa text not null,
  cargas integer not null default 0,
  atualizado_em timestamptz not null default now()
);

alter table public.vo_veiculo_responsavel enable row level security;
alter table public.vo_veiculo_codigo enable row level security;
revoke all on public.vo_veiculo_responsavel, public.vo_veiculo_codigo from anon, authenticated;
grant select on public.vo_veiculo_responsavel, public.vo_veiculo_codigo to anon;
drop policy if exists "leitura_app" on public.vo_veiculo_responsavel;
create policy "leitura_app" on public.vo_veiculo_responsavel for select to anon using (true);
drop policy if exists "leitura_app" on public.vo_veiculo_codigo;
create policy "leitura_app" on public.vo_veiculo_codigo for select to anon using (true);

insert into public.vo_veiculo_responsavel (placa, nome, de, ate, observacao) values
  -- Gerentes
  ('QWD9A33', 'DEUSIVALDO LEONCO FERREIRA',       '2025-01-01', '2025-02-19', 'Lista 2025 e historico'),
  ('RMC9J63', 'DEUSIVALDO LEONCO FERREIRA',       '2025-06-01', null,         'Lista 2026'),
  ('RSF9F88', 'FLAVIO CANDIDO DE FARIA',          '2025-01-01', '2026-05-27', 'Historico'),
  ('TVE7A70', 'FLAVIO CANDIDO DE FARIA',          '2026-06-02', null,         'Lista 2026'),
  ('RSF9G28', 'CARLOS ALEXANDRE SANTOS DE SOUZA', '2025-01-01', '2026-05-31', 'Historico'),
  ('TVD5D05', 'CARLOS ALEXANDRE SANTOS DE SOUZA', '2026-02-27', null,         'Lista 2026; sempre foi dele'),
  -- Supervisores
  ('RSF2B80', 'EDSON ARRUDA',                     '2025-01-01', '2026-03-02', 'Historico'),
  ('TVD5D17', 'EDSON ARRUDA',                     '2026-02-27', null,         'Lista 2026'),
  ('RSF1E97', 'RENNAN GOMES DOS SANTOS',          '2025-01-01', '2026-05-18', 'Historico'),
  ('TVD4I45', 'RENNAN GOMES DOS SANTOS',          '2026-02-25', null,         'Lista 2026; sempre foi dele'),
  ('RSF2C03', 'ALEXANDRE ALMEIDA BEZERRA',        '2025-05-19', '2026-10-03', 'Tiago 06/11: Eduardo antes do H85; lancamentos em nome do Jailson, postos de Araguaina'),
  ('TVG2B94', 'ALEXANDRE ALMEIDA BEZERRA',        '2026-09-24', null,         'Lista 2026'),
  ('RSF1J42', 'RUBERLEY MOREIRA MARTINS',         '2025-01-01', null,         'Lista 2026'),
  ('TVG2C01', 'RUBERLEY MOREIRA MARTINS',         '2026-09-23', null,         'Lista 2026'),
  ('RSF1J03', 'JAMIL JOSE DE SOUZA',              '2025-01-01', '2026-10-09', 'Lista 2026 e historico'),
  ('RSF1J03', 'JAMIL JOSE DE SOUZA',              '2026-10-29', null,         'Voltou apos o uso do Jailson'),
  ('TVG2B93', 'JAMIL JOSE DE SOUZA',              '2026-09-29', null,         'Lista 2026'),
  ('RSF2A03', 'JAILSON DA SILVA SANTOS',          '2025-01-26', '2026-07-11', 'Tiago 06/11: B43, A03, E71, J03 e E71; postos de Maraba'),
  ('TVF3E71', 'JAILSON DA SILVA SANTOS',          '2026-07-16', '2026-09-30', 'Tiago 06/11'),
  ('TVF3E71', 'JAILSON DA SILVA SANTOS',          '2026-10-28', null,         'Voltou apos o uso da RSF1J03'),
  ('RSF1J03', 'JAILSON DA SILVA SANTOS',          '2026-10-10', '2026-10-28', 'Historico por colaborador'),
  ('TVE7A67', 'FERDINANDO GOMES RIBEIRO',         '2026-10-03', null,         'Tiago 05/11; depois do ultimo uso do Victor Hugo'),
  -- Ex-supervisores, para o historico das carteiras
  ('RSF1F47', 'FRANCISLEY PEREIRA BATISTA',       '2025-01-01', '2026-02-24', 'Historico'),
  ('RSF2C30', 'FRANSOA FIGUEIREDO ALENCAR',       '2025-01-01', '2026-02-16', 'Historico'),
  ('RMA3E80', 'MARCIO DE SOUZA TORRES',           '2025-02-06', '2026-06-01', 'Historico')
on conflict (placa, nome, de) do nothing;

-- Agendamento: 06:40 de Brasilia (09:40 UTC)
select cron.unschedule('vo-custo-gestao') where exists (select 1 from cron.job where jobname = 'vo-custo-gestao');
select cron.schedule('vo-custo-gestao', '40 9 * * *', $job$
  select net.http_post(
    url := 'https://qxipgnkdbzxtfvuyupow.supabase.co/functions/v1/sync-custo-gestao',
    headers := jsonb_build_object('Content-Type','application/json',
               'x-sync-token', (select decrypted_secret from vault.decrypted_secrets where name = 'prod_sync_token')),
    body := '{}'::jsonb, timeout_milliseconds := 120000);
$job$);
