-- =============================================================================
-- Migration 86 - Acerto de motoristas: login com o MESMO usuario e senha do
-- JR-Oper (27/11/2026, versao 7.10.1)
--
-- Decisao do Tiago (27/11): nada de senha nova nem convite. A pagina /acerto
-- aceita o login do JR-Oper (e-mail ou nome, como na tela de entrada do app) e
-- a mesma senha, mas SO para quem estiver na lista acerto_usuarios
-- (usuario_id = usuarios.id).
--
-- A senha do app e guardada em usuarios.senha_hash pela sha256Sync (js/store.js),
-- que NAO e o SHA-256 padrao (o crivo de primos vai so ate 300: as duas ultimas
-- constantes K saem de 300 e 301). acerto__hash_app reproduz a mesma conta no
-- servidor com as constantes tiradas da propria funcao do app. Conferido com
-- '1234' -> 47e5529c... e outros vetores.
--
-- Diferente do app, aqui NAO se aceita o proprio hash como senha (o app aceita
-- 64 hex como se ja fosse o hash, e a tabela usuarios e legivel pela chave
-- publica). Continua valendo: 5 erros = 15 min de bloqueio; sessao de 12 h.
--
-- Sai: senha propria, convite, primeiro acesso e trocar senha (a senha se troca
-- no JR-Oper). Liberar alguem: select acerto_admin_liberar(<usuarios.id>, 'EDITOR');
-- =============================================================================

alter table public.acerto_usuarios add column if not exists usuario_id bigint unique;
alter table public.acerto_usuarios drop constraint if exists acerto_usuarios_login_check;

update public.acerto_usuarios
   set senha_hash = null, convite_hash = null, convite_expira = null, falhas = 0, bloqueado_ate = null;
delete from public.acerto_sessoes;

drop function if exists public.acerto_primeiro_acesso(text, text, text);
drop function if exists public.acerto_trocar_senha(text, text, text);
drop function if exists public.acerto_admin_convite(text);

-- -----------------------------------------------------------------------------
-- A conta de senha do app (sha256Sync), em inteiros de 32 bits sem sinal.
-- -----------------------------------------------------------------------------
create or replace function public.acerto__rotr(x bigint, n integer) returns bigint
language sql immutable as $$ select ((x >> n) | (x << (32 - n))) & 4294967295 $$;

create or replace function public.acerto__hash_app(p text) returns text
language plpgsql immutable as $$
declare
  k constant bigint[] := array[1116352408,1899447441,3049323471,3921009573,961987163,1508970993,2453635748,2870763221,
    3624381080,310598401,607225278,1426881987,1925078388,2162078206,2614888103,3248222580,3835390401,4022224774,
    264347078,604807628,770255983,1249150122,1555081692,1996064986,2554220882,2821834349,2952996808,3210313671,
    3336571891,3584528711,113926993,338241895,666307205,773529912,1294757372,1396182291,1695183700,1986661051,
    2177026350,2456956037,2730485921,2820302411,3259730800,3345764771,3516065817,3600352804,4094571909,275423344,
    430227734,506948616,659060556,883997877,958139571,1322822218,1537002063,1747873779,1955562222,2024104815,
    2227730452,2361852424,2428436474,2756734187,2982122498,3014033652];
  m constant bigint := 4294967295;
  h bigint[] := array[1779033703,3144134277,1013904242,2773480762,1359893119,2600822924,528734635,1541459225];
  b integer[] := '{}';
  w bigint[];
  a bigint; bb bigint; c bigint; d bigint; e bigint; f bigint; g bigint; hh bigint;
  t1 bigint; t2 bigint; s0 bigint; s1 bigint;
  n integer; bits bigint; blk integer; i integer; r text := '';
begin
  if p is null or p = '' then return ''; end if;
  -- como o app: cada caractere e um byte (codigo ate 255), senao a conta da vazio
  for i in 1..length(p) loop
    n := ascii(substr(p, i, 1));
    if n > 255 then return ''; end if;
    b := b || n;
  end loop;
  bits := length(p)::bigint * 8;
  b := b || 128;
  while (array_length(b, 1) % 64) <> 56 loop b := b || 0; end loop;
  b := b || array[0, 0, 0, 0,
                  ((bits >> 24) & 255)::int, ((bits >> 16) & 255)::int, ((bits >> 8) & 255)::int, (bits & 255)::int];

  for blk in 0..(array_length(b, 1) / 64 - 1) loop
    w := array_fill(0::bigint, array[64]);
    for i in 0..15 loop
      w[i + 1] := (b[blk * 64 + i * 4 + 1]::bigint << 24) | (b[blk * 64 + i * 4 + 2]::bigint << 16)
                | (b[blk * 64 + i * 4 + 3]::bigint << 8) | b[blk * 64 + i * 4 + 4]::bigint;
    end loop;
    for i in 16..63 loop
      s0 := public.acerto__rotr(w[i - 14], 7) # public.acerto__rotr(w[i - 14], 18) # (w[i - 14] >> 3);
      s1 := public.acerto__rotr(w[i - 1], 17) # public.acerto__rotr(w[i - 1], 19) # (w[i - 1] >> 10);
      w[i + 1] := (w[i - 15] + s0 + w[i - 6] + s1) & m;
    end loop;
    a := h[1]; bb := h[2]; c := h[3]; d := h[4]; e := h[5]; f := h[6]; g := h[7]; hh := h[8];
    for i in 0..63 loop
      t1 := (hh + (public.acerto__rotr(e, 6) # public.acerto__rotr(e, 11) # public.acerto__rotr(e, 25))
             + ((e & f) # ((e # m) & g)) + k[i + 1] + w[i + 1]) & m;
      t2 := ((public.acerto__rotr(a, 2) # public.acerto__rotr(a, 13) # public.acerto__rotr(a, 22))
             + ((a & bb) # (a & c) # (bb & c))) & m;
      hh := g; g := f; f := e; e := (d + t1) & m; d := c; c := bb; bb := a; a := (t1 + t2) & m;
    end loop;
    h[1] := (h[1] + a) & m; h[2] := (h[2] + bb) & m; h[3] := (h[3] + c) & m; h[4] := (h[4] + d) & m;
    h[5] := (h[5] + e) & m; h[6] := (h[6] + f) & m; h[7] := (h[7] + g) & m; h[8] := (h[8] + hh) & m;
  end loop;
  for i in 1..8 loop r := r || lpad(to_hex(h[i]), 8, '0'); end loop;
  return r;
end $$;

-- -----------------------------------------------------------------------------
-- Entrar com o login do JR-Oper: e-mail, nome inteiro ou comeco do nome (como o
-- app). Se o comeco do nome servir para mais de uma pessoa, pede o e-mail.
-- -----------------------------------------------------------------------------
create or replace function public.acerto_entrar(p_login text, p_senha text) returns json
language plpgsql security definer set search_path = public, extensions as $$
declare
  termo text := lower(trim(coalesce(p_login, '')));
  us record;
  qtd integer;
  au public.acerto_usuarios;
  h text;
  ok boolean;
begin
  if length(termo) < 3 then return json_build_object('erro', 'LOGIN_INVALIDO'); end if;
  select count(*) into qtd from public.usuarios
   where coalesce(ativo, true) and (lower(email) = termo or lower(nome) = termo);
  if qtd = 1 then
    select id, nome, senha_hash into us from public.usuarios
     where coalesce(ativo, true) and (lower(email) = termo or lower(nome) = termo);
  else
    if qtd = 0 then
      select count(*) into qtd from public.usuarios where coalesce(ativo, true) and left(lower(nome), length(termo)) = termo;
    end if;
    if qtd > 1 then return json_build_object('erro', 'LOGIN_AMBIGUO'); end if;
    if qtd = 0 then
      perform public.acerto__hash_app('x');
      return json_build_object('erro', 'LOGIN_INVALIDO');
    end if;
    select id, nome, senha_hash into us from public.usuarios
     where coalesce(ativo, true) and left(lower(nome), length(termo)) = termo;
  end if;

  select * into au from public.acerto_usuarios where usuario_id = us.id and ativo;
  if au.id is not null and au.bloqueado_ate > now() then return json_build_object('erro', 'BLOQUEADO'); end if;

  -- o proprio hash nunca vale como senha aqui
  if coalesce(p_senha, '') = '' or p_senha ~* '^[a-f0-9]{64}$' then
    ok := false;
  else
    h := public.acerto__hash_app(p_senha);
    ok := (h <> '' and h = us.senha_hash)
       or (us.senha_hash !~* '^[a-f0-9]{64}$' and us.senha_hash = p_senha);   -- senha antiga ainda sem hash (o app aceita)
  end if;

  if not ok then
    if au.id is not null then return public.acerto__falha(au.id); end if;
    return json_build_object('erro', 'LOGIN_INVALIDO');
  end if;
  if au.id is null then return json_build_object('erro', 'SEM_ACESSO'); end if;
  return public.acerto__nova_sessao(au.id);
end $$;

-- Liberar (ou trocar o papel de) um usuario do JR-Oper: so pelo SQL do Supabase.
create or replace function public.acerto_admin_liberar(p_usuario_id bigint, p_papel text default 'EDITOR', p_nome text default null)
returns text language plpgsql security definer set search_path = public as $$
declare us record;
begin
  select id, nome, email into us from public.usuarios where id = p_usuario_id;
  if us.id is null then raise exception 'USUARIO_NAO_ENCONTRADO'; end if;
  insert into public.acerto_usuarios (login, nome, papel, usuario_id)
  values (coalesce(lower(us.email), 'usuario-' || us.id), coalesce(p_nome, us.nome), upper(p_papel), us.id)
  on conflict (usuario_id) do update set papel = excluded.papel, nome = excluded.nome, ativo = true;
  return 'liberado: ' || coalesce(p_nome, us.nome) || ' (' || upper(p_papel) || ')';
end $$;

revoke all on function public.acerto__rotr(bigint, integer), public.acerto__hash_app(text),
  public.acerto_admin_liberar(bigint, text, text) from public, anon, authenticated;
revoke all on function public.acerto_entrar(text, text) from public;
grant execute on function public.acerto_entrar(text, text) to anon, authenticated;

-- Quem entra (27/11): Tiago (as duas contas dele no JR-Oper) e Paulo Silva.
-- Victor Hugo ainda nao tem usuario no JR-Oper: a linha fica sem usuario_id
-- ate ele ter; entao: select acerto_admin_liberar(<id>, 'EDITOR', 'Victor Hugo');
update public.acerto_usuarios set usuario_id = 1787514068461840, login = 'tiago.ferreira.alves@jrdistribuidora.com.br'
 where login = 'tiago';
update public.acerto_usuarios set usuario_id = 1789154164828418, login = 'paulo.alves.da.silva@jrdistribuidora.com.br'
 where login = 'paulo';
insert into public.acerto_usuarios (login, nome, papel, usuario_id)
values ('admin@jrdistribuidora.com.br', 'Tiago', 'ADMIN', 5)
on conflict (login) do nothing;
