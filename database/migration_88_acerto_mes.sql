-- =============================================================================
-- Migration 88 - Acerto de motoristas: tela "Acerto do mes" (28/11/2026, 7.11.0)
--
--   acerto_requisitos_mes  o que veio da planilha de Requisitos do mes (abas
--                          Motorista e Ajudante): ocorrencias por requisito,
--                          dias e peso garantido. A planilha continua sendo
--                          onde o Victor confere e abona; a tela importa.
--   acerto_pessoa_mes      ajuda extra e observacao do mes, por pessoa.
--   acerto_dados_mes()     tudo que a tela precisa para calcular o mes (as
--                          cargas faturadas e nao canceladas do Power BI, as
--                          compras, requisitos, extras e nomes).
-- Mes FECHADO (acerto_meses) nao aceita importacao nem ajuda extra nova.
-- Mesma seguranca da migration 85: RLS sem politica, so pelas funcoes.
-- =============================================================================

create table if not exists public.acerto_requisitos_mes (
  mes text not null check (mes ~ '^\d{4}-(0[1-9]|1[0-2])$'),
  funcao text not null check (funcao in ('MOTORISTA', 'AJUDANTE')),
  pessoa_id integer not null,
  nome text,
  req jsonb not null default '{}'::jsonb,
  dias numeric,
  garantido_t numeric,
  importado_por text,
  importado_em timestamptz not null default now(),
  arquivo text,
  primary key (mes, funcao, pessoa_id)
);

create table if not exists public.acerto_pessoa_mes (
  mes text not null check (mes ~ '^\d{4}-(0[1-9]|1[0-2])$'),
  funcao text not null check (funcao in ('MOTORISTA', 'AJUDANTE')),
  pessoa_id integer not null,
  ajuda numeric(12,2) not null default 0,
  obs text,
  alterado_por text,
  alterado_em timestamptz not null default now(),
  primary key (mes, funcao, pessoa_id)
);

alter table public.acerto_requisitos_mes enable row level security;
alter table public.acerto_pessoa_mes enable row level security;
revoke all on public.acerto_requisitos_mes, public.acerto_pessoa_mes from anon, authenticated;

create or replace function public.acerto__mes_aberto(p_mes text) returns void
language plpgsql security definer set search_path = public as $$
declare fech text := (select max(mes) from public.acerto_meses where status = 'FECHADO');
begin
  if p_mes !~ '^\d{4}-(0[1-9]|1[0-2])$' then raise exception 'MES_INVALIDO'; end if;
  if fech is not null and p_mes <= fech then raise exception 'MES_FECHADO'; end if;
end $$;

-- Dados do mes para o calculo (competencia 26 do mes anterior a 25, pela data
-- da carga no WinThor e pela data de entrada da compra).
create or replace function public.acerto_dados_mes(p_token text, p_mes text) returns json
language plpgsql security definer set search_path = public, extensions as $$
declare
  u public.acerto_usuarios := public.acerto__usuario(p_token);
  ini date; fim date;
begin
  if p_mes !~ '^\d{4}-(0[1-9]|1[0-2])$' then raise exception 'MES_INVALIDO'; end if;
  fim := (p_mes || '-25')::date;
  ini := ((p_mes || '-01')::date - interval '1 month')::date + 25;
  return json_build_object(
    'mes', p_mes, 'ini', ini, 'fim', fim,
    'cargas', coalesce((select json_agg(json_build_object('numcar', numcar, 'dtsaida', dtsaida, 'codmotorista', codmotorista,
        'codmot_transb', codmot_transb, 'codajud1', codajud1, 'codajud2', codajud2, 'codajud3', codajud3,
        'codajud_transb', codajud_transb, 'peso', peso, 'nument', nument, 'codrota', codrota, 'destino', destino) order by dtsaida, numcar)
      from public.acerto_pbi_cargas where dtsaida between ini and fim and dtfat is not null and dtcancel is null), '[]'),
    'sem_faturar', (select count(*) from public.acerto_pbi_cargas where dtsaida between ini and fim and dtfat is null and dtcancel is null),
    'compras', coalesce((select json_agg(json_build_object('numnota', numnota, 'dtent', dtent, 'matricula', matricula, 'peso', peso, 'uf', uf) order by dtent, numnota)
      from public.acerto_pbi_compras where dtent between ini and fim), '[]'),
    'requisitos', coalesce((select json_agg(json_build_object('funcao', funcao, 'pessoa_id', pessoa_id, 'nome', nome, 'req', req, 'dias', dias,
        'garantido_t', garantido_t, 'importado_por', importado_por, 'importado_em', importado_em, 'arquivo', arquivo))
      from public.acerto_requisitos_mes where mes = p_mes), '[]'),
    'extras', coalesce((select json_agg(json_build_object('funcao', funcao, 'pessoa_id', pessoa_id, 'ajuda', ajuda, 'obs', obs,
        'alterado_por', alterado_por, 'alterado_em', alterado_em)) from public.acerto_pessoa_mes where mes = p_mes), '[]'),
    'motoristas', coalesce((select json_agg(json_build_object('id', id, 'nome', nome, 'ativo', coalesce(ativo, true), 'data_desligamento', data_desligamento))
      from public.motoristas where not coalesce(is_deleted, false)), '[]'),
    'ajudantes', coalesce((select json_agg(json_build_object('id', id, 'nome', nome, 'ativo', coalesce(ativo, true)))
      from public.ajudantes where not coalesce(is_deleted, false)), '[]'),
    'sync', (select json_build_object('em', finalizado_em, 'status', status, 'erro', erro) from public.acerto_sync_log
      where status <> 'rodando' order by id desc limit 1)
  );
end $$;

-- Importa as abas Motorista e Ajudante da planilha de Requisitos (lidas no
-- navegador). Substitui a importacao anterior do mes.
create or replace function public.acerto_importar_requisitos(p_token text, p_mes text, p_arquivo text, p_linhas jsonb) returns json
language plpgsql security definer set search_path = public, extensions as $$
declare
  u public.acerto_usuarios := public.acerto__usuario(p_token);
  n integer;
begin
  if u.papel not in ('ADMIN', 'EDITOR') then raise exception 'SEM_PERMISSAO'; end if;
  perform public.acerto__mes_aberto(p_mes);
  if jsonb_typeof(p_linhas) <> 'array' or jsonb_array_length(p_linhas) = 0 or jsonb_array_length(p_linhas) > 500 then raise exception 'DADOS_INVALIDOS'; end if;
  delete from public.acerto_requisitos_mes where mes = p_mes;
  insert into public.acerto_requisitos_mes (mes, funcao, pessoa_id, nome, req, dias, garantido_t, importado_por, arquivo)
  select p_mes, x->>'funcao', (x->>'pessoa_id')::int, x->>'nome', coalesce(x->'req', '{}'::jsonb),
         nullif(x->>'dias', '')::numeric, nullif(x->>'garantido_t', '')::numeric, u.nome, left(p_arquivo, 200)
    from jsonb_array_elements(p_linhas) x
   where x->>'funcao' in ('MOTORISTA', 'AJUDANTE') and (x->>'pessoa_id') ~ '^\d+$'
  on conflict (mes, funcao, pessoa_id) do update set req = excluded.req, dias = excluded.dias, garantido_t = excluded.garantido_t,
     nome = excluded.nome, importado_por = excluded.importado_por, importado_em = now(), arquivo = excluded.arquivo;
  get diagnostics n = row_count;
  insert into public.acerto_log (usuario, acao, tipo, chave, vigencia, depois)
  values (u.nome, 'IMPORTOU_REQUISITOS', 'requisitos', p_arquivo, p_mes, jsonb_build_object('linhas', n));
  return json_build_object('ok', true, 'linhas', n);
end $$;

create or replace function public.acerto_salvar_extra(p_token text, p_mes text, p_funcao text, p_pessoa_id integer, p_ajuda numeric, p_obs text) returns json
language plpgsql security definer set search_path = public, extensions as $$
declare
  u public.acerto_usuarios := public.acerto__usuario(p_token);
  antes jsonb;
begin
  if u.papel not in ('ADMIN', 'EDITOR') then raise exception 'SEM_PERMISSAO'; end if;
  perform public.acerto__mes_aberto(p_mes);
  if p_funcao not in ('MOTORISTA', 'AJUDANTE') then raise exception 'DADOS_INVALIDOS'; end if;
  if coalesce(p_ajuda, 0) < 0 or coalesce(p_ajuda, 0) > 100000 then raise exception 'DADOS_INVALIDOS'; end if;
  select to_jsonb(x) into antes from public.acerto_pessoa_mes x where mes = p_mes and funcao = p_funcao and pessoa_id = p_pessoa_id;
  insert into public.acerto_pessoa_mes (mes, funcao, pessoa_id, ajuda, obs, alterado_por, alterado_em)
  values (p_mes, p_funcao, p_pessoa_id, coalesce(p_ajuda, 0), nullif(trim(coalesce(p_obs, '')), ''), u.nome, now())
  on conflict (mes, funcao, pessoa_id) do update set ajuda = excluded.ajuda, obs = excluded.obs, alterado_por = excluded.alterado_por, alterado_em = now();
  insert into public.acerto_log (usuario, acao, tipo, chave, vigencia, antes, depois)
  values (u.nome, 'AJUDA_EXTRA', 'pessoa_mes', p_funcao || ':' || p_pessoa_id, p_mes, antes,
          jsonb_build_object('ajuda', coalesce(p_ajuda, 0), 'obs', p_obs));
  return json_build_object('ok', true);
end $$;

revoke all on function public.acerto__mes_aberto(text) from public, anon, authenticated;
revoke all on function public.acerto_dados_mes(text, text), public.acerto_importar_requisitos(text, text, text, jsonb),
  public.acerto_salvar_extra(text, text, text, integer, numeric, text) from public;
grant execute on function public.acerto_dados_mes(text, text), public.acerto_importar_requisitos(text, text, text, jsonb),
  public.acerto_salvar_extra(text, text, text, integer, numeric, text) to anon, authenticated;
