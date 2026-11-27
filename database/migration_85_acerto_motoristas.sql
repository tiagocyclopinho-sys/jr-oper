-- =============================================================================
-- Migration 85 - Acerto de motoristas e ajudantes: login e matriz de regras
-- (27/11/2026, versao 7.10.0)
--
-- Pagina /acerto (fora do app, como /banco-horas), COM login e senha. E a unica
-- parte do JR-Oper que mostra valores em R$ (excecao decidida pelo Tiago em
-- 27/11). Por isso, ao contrario do resto do banco:
--   * as tabelas acerto_* tem RLS ligada e NENHUMA politica: a chave publica
--     (anon) nao le nem grava nada direto nelas;
--   * tudo passa por funcoes security definer que conferem a sessao;
--   * a senha e conferida no servidor (bcrypt do pgcrypto), nunca no navegador.
--
--   acerto_usuarios  Tiago (ADMIN), Victor Hugo (EDITOR), Paulo Silva (EDITOR;
--                    CONFERENTE = so consulta, sem ninguem por ora). 1o acesso por convite de uso unico (7 dias);
--                    5 senhas erradas bloqueiam o login por 15 min.
--   acerto_sessoes   so o SHA-256 do token; vale 12 h.
--   acerto_regras    a matriz editavel, VERSIONADA: (tipo, chave, vigencia).
--                    O valor de um mes M e a versao de maior vigencia <= M.
--                    Mudar uma regra cria/edita a versao do mes escolhido; as
--                    anteriores ficam. Mes FECHADO nao aceita versao nova.
--                    tipos: parametro, faixa, perfil, pessoa, rota, compra
--                    (editaveis) e pcrotaexp (referencia do WinThor, so leitura).
--   acerto_meses     ABERTO/FECHADO por competencia (26 do mes anterior a 25).
--   acerto_log       quem mudou o que (antes/depois).
-- =============================================================================

create extension if not exists pgcrypto with schema extensions;

create table if not exists public.acerto_usuarios (
  id serial primary key,
  login text not null unique check (login = lower(login)),
  nome text not null,
  papel text not null check (papel in ('ADMIN', 'EDITOR', 'CONFERENTE')),
  senha_hash text,
  convite_hash text,
  convite_expira timestamptz,
  falhas integer not null default 0,
  bloqueado_ate timestamptz,
  ativo boolean not null default true,
  criado_em timestamptz not null default now(),
  ultimo_acesso timestamptz
);

create table if not exists public.acerto_sessoes (
  token_hash text primary key,
  usuario_id integer not null references public.acerto_usuarios (id) on delete cascade,
  criada_em timestamptz not null default now(),
  expira_em timestamptz not null
);

create table if not exists public.acerto_regras (
  tipo text not null check (tipo in ('parametro', 'faixa', 'perfil', 'pessoa', 'rota', 'compra', 'pcrotaexp')),
  chave text not null check (length(chave) between 1 and 120),
  vigencia text not null check (vigencia ~ '^\d{4}-(0[1-9]|1[0-2])$'),
  dados jsonb not null check (jsonb_typeof(dados) = 'object'),
  alterado_por text,
  alterado_em timestamptz not null default now(),
  primary key (tipo, chave, vigencia)
);

create table if not exists public.acerto_meses (
  mes text primary key check (mes ~ '^\d{4}-(0[1-9]|1[0-2])$'),
  status text not null default 'ABERTO' check (status in ('ABERTO', 'FECHADO')),
  fechado_em timestamptz,
  fechado_por text
);

create table if not exists public.acerto_log (
  id bigint generated always as identity primary key,
  em timestamptz not null default now(),
  usuario text,
  acao text not null,
  tipo text,
  chave text,
  vigencia text,
  antes jsonb,
  depois jsonb
);

alter table public.acerto_usuarios enable row level security;
alter table public.acerto_sessoes enable row level security;
alter table public.acerto_regras enable row level security;
alter table public.acerto_meses enable row level security;
alter table public.acerto_log enable row level security;
revoke all on public.acerto_usuarios, public.acerto_sessoes, public.acerto_regras,
  public.acerto_meses, public.acerto_log from anon, authenticated;

-- -----------------------------------------------------------------------------
-- Chave de casamento de nomes (rota, fornecedor): sem acento, sem pontuacao,
-- 01/02/03 = I/II/III e palavras em ordem ("SECO - ARAGUAINA" = "ARAGUAINA
-- SECO", "MARABA 02" = "MARABA II"). A mesma regra esta em js/acertoRegras.js.
-- -----------------------------------------------------------------------------
create or replace function public.acerto_chave(p text) returns text
language sql immutable set search_path = public as $$
  select coalesce(string_agg(w, ' ' order by w), '') from (
    select case x when '1' then 'I' when '01' then 'I' when '2' then 'II' when '02' then 'II'
                  when '3' then 'III' when '03' then 'III' else x end as w
    from regexp_split_to_table(trim(regexp_replace(upper(translate(coalesce(p, ''),
      'áàâãäéèêëíìîïóòôõöúùûüçñÁÀÂÃÄÉÈÊËÍÌÎÏÓÒÔÕÖÚÙÛÜÇÑ',
      'aaaaaeeeeiiiiooooouuuucnAAAAAEEEEIIIIOOOOOUUUUCN')), '[^A-Z0-9]+', ' ', 'g')), ' ') as x
  ) t where w <> ''
$$;

-- Competencia de uma data (26 do mes anterior a 25): 27/11 -> 2026-12.
create or replace function public.acerto_competencia(d date) returns text
language sql immutable as $$
  select to_char(case when extract(day from d) >= 26 then (date_trunc('month', d) + interval '1 month') else date_trunc('month', d) end, 'YYYY-MM')
$$;

-- -----------------------------------------------------------------------------
-- Sessao (uso interno)
-- -----------------------------------------------------------------------------
create or replace function public.acerto__usuario(p_token text) returns public.acerto_usuarios
language plpgsql security definer set search_path = public, extensions as $$
declare u public.acerto_usuarios;
begin
  select u2.* into u from public.acerto_sessoes s join public.acerto_usuarios u2 on u2.id = s.usuario_id
   where s.token_hash = encode(extensions.digest(coalesce(p_token, ''), 'sha256'), 'hex')
     and s.expira_em > now() and u2.ativo;
  if u.id is null then
    raise exception 'SESSAO_INVALIDA' using errcode = '28000', hint = 'Entre de novo.';
  end if;
  return u;
end $$;

create or replace function public.acerto__nova_sessao(p_uid integer) returns json
language plpgsql security definer set search_path = public, extensions as $$
declare t text := encode(extensions.gen_random_bytes(32), 'hex'); u public.acerto_usuarios;
begin
  delete from public.acerto_sessoes where expira_em < now();
  insert into public.acerto_sessoes (token_hash, usuario_id, expira_em)
  values (encode(extensions.digest(t, 'sha256'), 'hex'), p_uid, now() + interval '12 hours');
  update public.acerto_usuarios set falhas = 0, bloqueado_ate = null, ultimo_acesso = now()
   where id = p_uid returning * into u;
  insert into public.acerto_log (usuario, acao) values (u.nome, 'ENTROU');
  return json_build_object('token', t, 'nome', u.nome, 'papel', u.papel, 'login', u.login,
                           'expira_em', now() + interval '12 hours');
end $$;

-- Senha ou convite errado: conta a falha (5 = bloqueio de 15 min). Devolve json
-- em vez de erro para a contagem nao ser desfeita pelo rollback.
create or replace function public.acerto__falha(p_uid integer) returns json
language plpgsql security definer set search_path = public as $$
declare f integer;
begin
  update public.acerto_usuarios set falhas = falhas + 1 where id = p_uid returning falhas into f;
  if f >= 5 then
    update public.acerto_usuarios set falhas = 0, bloqueado_ate = now() + interval '15 minutes' where id = p_uid;
    return json_build_object('erro', 'BLOQUEADO');
  end if;
  return json_build_object('erro', 'LOGIN_INVALIDO');
end $$;

-- -----------------------------------------------------------------------------
-- Login
-- -----------------------------------------------------------------------------
create or replace function public.acerto_entrar(p_login text, p_senha text) returns json
language plpgsql security definer set search_path = public, extensions as $$
declare u public.acerto_usuarios;
begin
  select * into u from public.acerto_usuarios where login = lower(trim(coalesce(p_login, ''))) and ativo;
  if u.id is null then
    perform extensions.crypt('x', extensions.gen_salt('bf', 10));   -- mesmo tempo de resposta
    return json_build_object('erro', 'LOGIN_INVALIDO');
  end if;
  if u.bloqueado_ate > now() then return json_build_object('erro', 'BLOQUEADO'); end if;
  if u.senha_hash is null then return json_build_object('erro', 'PRIMEIRO_ACESSO'); end if;
  if extensions.crypt(coalesce(p_senha, ''), u.senha_hash) <> u.senha_hash then
    return public.acerto__falha(u.id);
  end if;
  return public.acerto__nova_sessao(u.id);
end $$;

create or replace function public.acerto_primeiro_acesso(p_login text, p_convite text, p_senha text) returns json
language plpgsql security definer set search_path = public, extensions as $$
declare u public.acerto_usuarios;
begin
  select * into u from public.acerto_usuarios where login = lower(trim(coalesce(p_login, ''))) and ativo;
  if u.id is null or u.convite_hash is null or u.convite_expira < now() then
    return json_build_object('erro', 'CONVITE_INVALIDO');
  end if;
  if u.bloqueado_ate > now() then return json_build_object('erro', 'BLOQUEADO'); end if;
  if extensions.crypt(upper(trim(coalesce(p_convite, ''))), u.convite_hash) <> u.convite_hash then
    perform public.acerto__falha(u.id);
    return json_build_object('erro', 'CONVITE_INVALIDO');
  end if;
  if length(coalesce(p_senha, '')) < 8 then return json_build_object('erro', 'SENHA_CURTA'); end if;
  update public.acerto_usuarios
     set senha_hash = extensions.crypt(p_senha, extensions.gen_salt('bf', 10)), convite_hash = null, convite_expira = null
   where id = u.id;
  insert into public.acerto_log (usuario, acao) values (u.nome, 'DEFINIU_SENHA');
  return public.acerto__nova_sessao(u.id);
end $$;

create or replace function public.acerto_trocar_senha(p_token text, p_atual text, p_nova text) returns json
language plpgsql security definer set search_path = public, extensions as $$
declare u public.acerto_usuarios := public.acerto__usuario(p_token);
begin
  if extensions.crypt(coalesce(p_atual, ''), u.senha_hash) <> u.senha_hash then
    return json_build_object('erro', 'SENHA_ATUAL');
  end if;
  if length(coalesce(p_nova, '')) < 8 then return json_build_object('erro', 'SENHA_CURTA'); end if;
  update public.acerto_usuarios set senha_hash = extensions.crypt(p_nova, extensions.gen_salt('bf', 10)) where id = u.id;
  delete from public.acerto_sessoes where usuario_id = u.id
     and token_hash <> encode(extensions.digest(p_token, 'sha256'), 'hex');
  insert into public.acerto_log (usuario, acao) values (u.nome, 'TROCOU_SENHA');
  return json_build_object('ok', true);
end $$;

create or replace function public.acerto_sair(p_token text) returns json
language plpgsql security definer set search_path = public, extensions as $$
begin
  delete from public.acerto_sessoes where token_hash = encode(extensions.digest(coalesce(p_token, ''), 'sha256'), 'hex');
  return json_build_object('ok', true);
end $$;

-- -----------------------------------------------------------------------------
-- Leitura: todas as versoes das regras (poucas centenas) + cadastros e as rotas
-- das viagens da competencia, para a tela montar o "vale em M" e o historico.
-- -----------------------------------------------------------------------------
create or replace function public.acerto_dados(p_token text, p_mes text) returns json
language plpgsql security definer set search_path = public, extensions as $$
declare
  u public.acerto_usuarios := public.acerto__usuario(p_token);
  ini date; fim date;
begin
  if p_mes !~ '^\d{4}-(0[1-9]|1[0-2])$' then raise exception 'MES_INVALIDO'; end if;
  fim := (p_mes || '-25')::date;
  ini := ((p_mes || '-01')::date - interval '1 month')::date + 25;
  return json_build_object(
    'usuario', json_build_object('nome', u.nome, 'papel', u.papel, 'login', u.login),
    'mes', p_mes,
    'competencia_atual', public.acerto_competencia((now() at time zone 'America/Sao_Paulo')::date),
    'fechado_ate', (select max(mes) from public.acerto_meses where status = 'FECHADO'),
    'meses', coalesce((select json_agg(json_build_object('mes', mes, 'status', status, 'fechado_em', fechado_em, 'fechado_por', fechado_por) order by mes) from public.acerto_meses), '[]'),
    'regras', coalesce((select json_agg(json_build_object('tipo', tipo, 'chave', chave, 'vigencia', vigencia, 'dados', dados,
                         'alterado_por', alterado_por, 'alterado_em', alterado_em) order by tipo, chave, vigencia) from public.acerto_regras), '[]'),
    'motoristas', coalesce((select json_agg(json_build_object('id', id, 'nome', nome, 'ativo', coalesce(ativo, true), 'uso_escala', uso_escala,
                         'data_desligamento', data_desligamento) order by nome) from public.motoristas where not coalesce(is_deleted, false)), '[]'),
    'ajudantes', coalesce((select json_agg(json_build_object('id', id, 'nome', nome, 'ativo', coalesce(ativo, true), 'uso_escala', uso_escala) order by nome)
                         from public.ajudantes where not coalesce(is_deleted, false)), '[]'),
    'rotas_cadastro', coalesce((select json_agg(nome order by nome) from public.rotas where coalesce(ativo, true)), '[]'),
    'rotas_viagens', coalesce((select json_agg(json_build_object('rota', rota, 'viagens', n) order by n desc) from (
                         select rota, count(*) n from public.controle_viagens
                          where not coalesce(is_deleted, false) and rota is not null and data_saida::date between ini and fim
                          group by rota) v), '[]'),
    'periodo', json_build_object('ini', ini, 'fim', fim)
  );
end $$;

-- -----------------------------------------------------------------------------
-- Gravacao de uma versao da regra (ADMIN e EDITOR). Mes fechado nao muda.
-- -----------------------------------------------------------------------------
create or replace function public.acerto_salvar(p_token text, p_tipo text, p_chave text, p_vigencia text, p_dados jsonb) returns json
language plpgsql security definer set search_path = public, extensions as $$
declare
  u public.acerto_usuarios := public.acerto__usuario(p_token);
  fech text := (select max(mes) from public.acerto_meses where status = 'FECHADO');
  antes jsonb;
begin
  if u.papel not in ('ADMIN', 'EDITOR') then raise exception 'SEM_PERMISSAO' using hint = 'Seu acesso e so de consulta.'; end if;
  if p_tipo not in ('parametro', 'faixa', 'perfil', 'pessoa', 'rota', 'compra') then raise exception 'TIPO_INVALIDO'; end if;
  if coalesce(trim(p_chave), '') = '' or length(p_chave) > 120 then raise exception 'CHAVE_INVALIDA'; end if;
  if p_vigencia !~ '^\d{4}-(0[1-9]|1[0-2])$' then raise exception 'MES_INVALIDO'; end if;
  if fech is not null and p_vigencia <= fech then
    raise exception 'MES_FECHADO' using hint = 'O mes ' || fech || ' ja foi fechado: a mudanca so pode valer a partir do mes seguinte.';
  end if;
  if p_dados is null or jsonb_typeof(p_dados) <> 'object' or octet_length(p_dados::text) > 20000 then raise exception 'DADOS_INVALIDOS'; end if;
  select dados into antes from public.acerto_regras where tipo = p_tipo and chave = p_chave and vigencia = p_vigencia;
  insert into public.acerto_regras (tipo, chave, vigencia, dados, alterado_por, alterado_em)
  values (p_tipo, p_chave, p_vigencia, p_dados, u.nome, now())
  on conflict (tipo, chave, vigencia) do update set dados = excluded.dados, alterado_por = excluded.alterado_por, alterado_em = now();
  insert into public.acerto_log (usuario, acao, tipo, chave, vigencia, antes, depois)
  values (u.nome, 'SALVOU', p_tipo, p_chave, p_vigencia, antes, p_dados);
  return json_build_object('ok', true);
end $$;

-- Apaga UMA versao (ex.: lancada no mes errado). A carga inicial e versoes de mes
-- fechado ficam. Sobra a versao anterior, que volta a valer.
create or replace function public.acerto_desfazer(p_token text, p_tipo text, p_chave text, p_vigencia text) returns json
language plpgsql security definer set search_path = public, extensions as $$
declare
  u public.acerto_usuarios := public.acerto__usuario(p_token);
  fech text := (select max(mes) from public.acerto_meses where status = 'FECHADO');
  antes jsonb;
begin
  if u.papel not in ('ADMIN', 'EDITOR') then raise exception 'SEM_PERMISSAO'; end if;
  if p_tipo = 'pcrotaexp' then raise exception 'TIPO_INVALIDO'; end if;
  if fech is not null and p_vigencia <= fech then raise exception 'MES_FECHADO'; end if;
  delete from public.acerto_regras where tipo = p_tipo and chave = p_chave and vigencia = p_vigencia returning dados into antes;
  if antes is null then raise exception 'VERSAO_NAO_ENCONTRADA'; end if;
  insert into public.acerto_log (usuario, acao, tipo, chave, vigencia, antes)
  values (u.nome, 'DESFEZ', p_tipo, p_chave, p_vigencia, antes);
  return json_build_object('ok', true);
end $$;

create or replace function public.acerto_historico(p_token text, p_limite integer default 200) returns json
language plpgsql security definer set search_path = public, extensions as $$
declare u public.acerto_usuarios := public.acerto__usuario(p_token);
begin
  return coalesce((select json_agg(l) from (select em, usuario, acao, tipo, chave, vigencia, antes, depois
                   from public.acerto_log order by em desc limit least(greatest(coalesce(p_limite, 200), 1), 1000)) l), '[]');
end $$;

-- Convite de 1o acesso: so pelo SQL do Supabase (nao e liberado para a chave publica).
create or replace function public.acerto_admin_convite(p_login text) returns text
language plpgsql security definer set search_path = public, extensions as $$
declare
  alfabeto text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  b bytea := extensions.gen_random_bytes(10);
  c text := '';
begin
  for i in 0..9 loop c := c || substr(alfabeto, (get_byte(b, i) % 32) + 1, 1); end loop;
  update public.acerto_usuarios
     set convite_hash = extensions.crypt(c, extensions.gen_salt('bf', 10)), convite_expira = now() + interval '7 days',
         senha_hash = null, falhas = 0, bloqueado_ate = null
   where login = lower(p_login);
  if not found then raise exception 'USUARIO_NAO_ENCONTRADO'; end if;
  delete from public.acerto_sessoes where usuario_id = (select id from public.acerto_usuarios where login = lower(p_login));
  return c;
end $$;

revoke all on function public.acerto__usuario(text), public.acerto__nova_sessao(integer), public.acerto__falha(integer),
  public.acerto_admin_convite(text) from public, anon, authenticated;
revoke all on function public.acerto_entrar(text, text), public.acerto_primeiro_acesso(text, text, text),
  public.acerto_trocar_senha(text, text, text), public.acerto_sair(text), public.acerto_dados(text, text),
  public.acerto_salvar(text, text, text, text, jsonb), public.acerto_desfazer(text, text, text, text),
  public.acerto_historico(text, integer) from public;
grant execute on function public.acerto_entrar(text, text), public.acerto_primeiro_acesso(text, text, text),
  public.acerto_trocar_senha(text, text, text), public.acerto_sair(text), public.acerto_dados(text, text),
  public.acerto_salvar(text, text, text, text, jsonb), public.acerto_desfazer(text, text, text, text),
  public.acerto_historico(text, integer) to anon, authenticated;

-- =============================================================================
-- Carga inicial (vigencia 2026-01, vale para o teste de novembro/26)
-- =============================================================================
insert into public.acerto_usuarios (login, nome, papel) values
  ('tiago', 'Tiago', 'ADMIN'),
  ('victor', 'Victor Hugo', 'EDITOR'),
  ('paulo', 'Paulo Silva', 'EDITOR')
on conflict (login) do nothing;

-- Parametros gerais
insert into public.acerto_regras (tipo, chave, vigencia, dados, alterado_por) values
  ('parametro', 'TON_TRANSBORDO_SIM', '2026-01', '{"valor":250,"rotulo":"Faixa de Transbordo = Sim: R$/t de todas as cargas"}', 'Carga inicial (27/11/2026)'),
  ('parametro', 'TON_MOTORISTA_TRANSBORDO', '2026-01', '{"valor":350,"rotulo":"R$/t das cargas em que ele é o motorista do transbordo"}', 'Carga inicial (27/11/2026)'),
  ('parametro', 'TON_CARNE', '2026-01', '{"valor":300,"rotulo":"Tonelada Carne = Sim: R$/t de todas as cargas"}', 'Carga inicial (27/11/2026)'),
  ('parametro', 'PRAZO_ROTA_TOLERANCIA_H', '2026-01', '{"valor":15,"rotulo":"Prazo Rota: horas de tolerância depois da previsão da matriz"}', 'Carga inicial (27/11/2026)')
on conflict do nothing;

-- Faixas (valores mais comuns da PCROTAEXP de 27/11)
insert into public.acerto_regras (tipo, chave, vigencia, dados, alterado_por) values
  ('faixa', '1', '2026-01', '{"vl_ton_mot":330,"vl_ton_ajud":38,"perc":10}', 'Carga inicial (27/11/2026)'),
  ('faixa', '2', '2026-01', '{"vl_ton_mot":430,"vl_ton_ajud":40,"perc":10}', 'Carga inicial (27/11/2026)'),
  ('faixa', '3', '2026-01', '{"vl_ton_mot":450,"vl_ton_ajud":42,"perc":10}', 'Carga inicial (27/11/2026)'),
  ('faixa', '4', '2026-01', '{"vl_ton_mot":470,"vl_ton_ajud":45,"perc":10}', 'Carga inicial (27/11/2026)'),
  ('faixa', '5', '2026-01', '{"vl_ton_mot":500,"vl_ton_ajud":47,"perc":10}', 'Carga inicial (27/11/2026)')
on conflict do nothing;

-- Perfis. KPIs do carreteiro pela rotina 8003 (a planilha de remuneracao diz
-- 250/250/200/200/100): conferir na tela.
insert into public.acerto_regras (tipo, chave, vigencia, dados, alterado_por) values
  ('perfil', 'MOTORISTA_PADRAO', '2026-01', '{"nome":"Motorista padrão","funcao":"MOTORISTA","tipo":"CAMINHONEIRO","ton_garantida":70,"perc_comissao":10,"bonus_entrega":0.25,"vl_ton_fixo":null,"ton_carne":false,"kpis":{"MANUTENCAO":200,"PNEUS":100,"SINISTRO":200,"CONSUMO":100,"PRAZO_ROTA":400,"CAIXA":100,"DEVOLUCAO":100,"FUSION":400}}', 'Carga inicial (27/11/2026)'),
  ('perfil', 'MOTORISTA_CARRETEIRO', '2026-01', '{"nome":"Carreteiro","funcao":"MOTORISTA","tipo":"CARRETEIRO","ton_garantida":120,"perc_comissao":10,"bonus_entrega":0.25,"vl_ton_fixo":null,"ton_carne":false,"kpis":{"MANUTENCAO":200,"PNEUS":100,"SINISTRO":200,"CONSUMO":100,"PRAZO_ROTA":400},"obs":"Sem Acerto de Caixa, Devolução e Fusion. KPIs pela rotina 8003; a planilha de remuneração diz 250/250/200/200/100."}', 'Carga inicial (27/11/2026)'),
  ('perfil', 'MOTORISTA_CARNE', '2026-01', '{"nome":"Carne","funcao":"MOTORISTA","tipo":"CAMINHONEIRO","ton_garantida":140,"perc_comissao":10,"bonus_entrega":0.25,"vl_ton_fixo":null,"ton_carne":true,"kpis":{"MANUTENCAO":200,"PNEUS":100,"SINISTRO":200,"CONSUMO":100,"PRAZO_ROTA":400,"CAIXA":100,"DEVOLUCAO":100,"FUSION":400},"obs":"Tonelada Carne: todas as cargas pagam o R$/t da carne (parâmetro TON_CARNE)."}', 'Carga inicial (27/11/2026)'),
  ('perfil', 'AJUDANTE_PADRAO', '2026-01', '{"nome":"Ajudante padrão","funcao":"AJUDANTE","tipo":"AJUDANTE","ton_garantida":70,"perc_comissao":null,"bonus_entrega":null,"vl_ton_fixo":null,"ton_carne":false,"kpis":{"DEVOLUCAO":100,"PONTUALIDADE":100,"PRAZO_ROTA":100}}', 'Carga inicial (27/11/2026)'),
  ('perfil', 'AJUDANTE_LOMBADOR', '2026-01', '{"nome":"Lombador / tombador","funcao":"AJUDANTE","tipo":"AJUDANTE","ton_garantida":70,"perc_comissao":null,"bonus_entrega":null,"vl_ton_fixo":23,"ton_carne":false,"kpis":{"DEVOLUCAO":100,"PONTUALIDADE":100,"PRAZO_ROTA":100},"obs":"Faixa 3 da rotina 8009 (R$ 23/t em todas as cargas)."}', 'Carga inicial (27/11/2026)')
on conflict do nothing;

-- Pessoas fora do perfil padrao (as demais seguem o padrao da funcao)
insert into public.acerto_regras (tipo, chave, vigencia, dados, alterado_por)
select 'pessoa', 'MOTORISTA:' || m.id, '2026-01',
       jsonb_build_object('funcao', 'MOTORISTA', 'pessoa_id', m.id, 'nome', m.nome, 'perfil', p.perfil), 'Carga inicial (27/11/2026)'
  from public.motoristas m
  join (values ('FAGNO PEREIRA ALMEIDA', 'MOTORISTA_CARRETEIRO'), ('CELIO ALVES OLIVEIRA', 'MOTORISTA_CARRETEIRO'),
               ('SILVESTRE LOPES DE ARAUJO', 'MOTORISTA_CARNE')) p (nome, perfil) on p.nome = m.nome
 where not coalesce(m.is_deleted, false)
on conflict do nothing;
insert into public.acerto_regras (tipo, chave, vigencia, dados, alterado_por)
select 'pessoa', 'AJUDANTE:' || a.id, '2026-01',
       jsonb_build_object('funcao', 'AJUDANTE', 'pessoa_id', a.id, 'nome', a.nome, 'perfil', 'AJUDANTE_LOMBADOR'), 'Carga inicial (27/11/2026)'
  from public.ajudantes a where a.nome = 'GABRIEL RODRIGUES DOS SANTOS' and not coalesce(a.is_deleted, false)
on conflict do nothing;

-- PCROTAEXP de 27/11 (CSV do Tiago), referencia so leitura
with p (codrota, descricao, vlton, faixa, perc, tongar, vlajud) as (values
  (1,'ARAGUAINA I',330,1,10,70,38),(2,'GUARAI',450,3,10,70,42),(3,'CAMPOS LINDOS',450,3,10,70,42),(4,'ARAGUATINS',450,3,10,70,42),
  (5,'SANTA FE',430,2,10,70,40),(6,'COLINAS',430,2,10,70,40),(7,'MARANHAO',null,null,null,70,null),(8,'PALMAS I',330,1,10,70,38),
  (9,'GOIAS',null,null,null,70,null),(10,'CTE Araguaina',null,null,null,70,null),(11,'PARA',null,null,null,70,null),
  (12,'TOCANTINOPOLIS',430,2,10,70,40),(13,'ITACAJA',470,4,10,70,45),(14,'COLMEIA',450,3,10,70,42),(15,'PALMAS II',330,1,10,70,38),
  (16,'PALMAS III',330,1,10,70,38),(17,'PARAISO DO TOCANTINS',430,2,10,70,40),(18,'MIRACEMA',470,4,10,70,45),
  (19,'ARAGUAINA II',330,1,10,70,38),(20,'NOVA OLINDA',430,2,10,70,40),(21,'XAMBIOA',430,2,10,70,40),
  (22,'LAGOA DA CONFUSAO',500,5,10,70,47),(23,'DIVINOPOLIS',500,5,10,70,47),(24,'PORTO NACIONAL',450,2,10,70,40),
  (25,'GURUPI',500,5,10,70,47),(26,'NATIVIDADE',450,3,10,70,42),(27,'DIANOPOLIS',470,4,10,70,45),(28,'FORMOSO DO ARAGUAIA',500,5,10,70,47),
  (29,'PALMEIROPOLIS',500,5,10,70,47),(30,'AXIXA',450,3,10,70,42),(31,'AUGUSTINOPOLIS',470,4,10,70,45),(33,'SERRA DO LAJEADO',450,3,10,70,42),
  (34,'COMBINADO',500,5,10,70,47),(35,'BABACULANDIA',430,2,10,70,40),(36,'ALIANCA DO TOCANTINS',450,3,10,70,42),(37,'RIO SONO',null,null,null,70,null),
  (38,'MARABA I',450,3,10,70,45),(39,'MARABA II',330,1,10,70,45),(40,'MARABA III',470,4,10,70,45),(41,'SAO GERALDO',450,3,10,70,42),
  (43,'CONCEICAO DO ARAGUAIA',null,null,null,70,null),(44,'REDENCAO I',500,5,10,70,47),(48,'ELDORADO DOS CARAJAS',null,null,null,70,null),
  (49,'CANAA DOS CARAJAS',450,3,10,70,42),(50,'PARAUAPEBAS I',470,4,10,70,45),(51,'PARAUAPEBAS II',450,3,10,70,42),
  (52,'PARAUAPEBAS III',450,3,10,70,42),(53,'NOVO REPARTIMENTO',500,5,10,70,47),(54,'XINGUARA',450,3,10,70,42),
  (55,'SANTANA DO ARAGUAIA',500,5,10,70,47),(56,'SAO FELIX DO XINGU',500,5,10,null,47),(57,'TUCUMA',470,4,10,null,47),
  (58,'PEDRO AFONSO',450,3,10,null,42),(59,'PORTO FRANCO - MA',430,2,10,null,40),(61,'IMPERATRIZ - MA',null,null,null,null,null),
  (62,'ACAILANDIA - MA',450,3,10,null,42),(63,'GOIANIA - GO',null,null,null,null,null),(64,'BALSAS - MA',450,3,10,null,42)
)
insert into public.acerto_regras (tipo, chave, vigencia, dados, alterado_por)
select 'pcrotaexp', codrota::text, '2026-01',
       jsonb_build_object('codrota', codrota, 'descricao', descricao, 'vl_ton_mot', vlton, 'faixa', faixa, 'perc', perc,
                          'ton_garantida', tongar, 'vl_ton_ajud', vlajud), 'PCROTAEXP 27/11/2026'
  from p
on conflict do nothing;

-- Rotas do JR-Oper (Cadastros Mestres). Valores copiados da PCROTAEXP quando o
-- nome casa; as demais ficam sem faixa para preencher na tela.
insert into public.acerto_regras (tipo, chave, vigencia, dados, alterado_por)
select distinct on (public.acerto_chave(r.nome))
       'rota', public.acerto_chave(r.nome), '2026-01',
       jsonb_build_object('nome', r.nome, 'faixa', (x.dados->>'faixa')::int, 'vl_ton_mot', (x.dados->>'vl_ton_mot')::numeric,
                          'vl_ton_ajud', (x.dados->>'vl_ton_ajud')::numeric, 'perc', (x.dados->>'perc')::numeric,
                          'apelidos', '[]'::jsonb,
                          'ignorar', public.acerto_chave(r.nome) in ('CARREGAMENTO', 'OFICINA SAIDA', 'PADRAO SAIDA'),
                          'origem', case when x.chave is not null then 'PCROTAEXP ' || (x.dados->>'codrota') || ' - ' || (x.dados->>'descricao')
                                         else 'sem correspondência na PCROTAEXP' end),
       'Carga inicial (27/11/2026)'
  from public.rotas r
  left join public.acerto_regras x on x.tipo = 'pcrotaexp' and x.dados->>'vl_ton_mot' is not null
        and public.acerto_chave(x.dados->>'descricao') = public.acerto_chave(r.nome)
 where coalesce(r.ativo, true) and public.acerto_chave(r.nome) <> ''
 order by public.acerto_chave(r.nome), r.nome
on conflict do nothing;
