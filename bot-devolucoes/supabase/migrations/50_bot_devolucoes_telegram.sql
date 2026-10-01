-- =============================================================================
-- MIGRATION 50 - BOT DE DEVOLUCOES NO TELEGRAM (versao simples, sem IA)
--
-- O QUE FAZ
--   Cria as tabelas do bot, as funcoes de busca, a trava de transicao de
--   status e o bucket privado das fotos. Acrescenta colunas de configuracao
--   na motivos_devolucao e cadastra a lista inicial de motivos.
--
-- O QUE NAO FAZ
--   Nao altera nenhuma linha nem nenhuma coluna das tabelas que o Jr-Oper
--   sincroniza. A motivos_devolucao estava VAZIA na producao em 30/09/2026 e
--   nao esta no MAPA_TABELAS do js/cloudStore.js, entao o app nao a le.
--   Nenhuma tabela existente ganha trigger.
--
-- SEGURANCA
--   Todas as tabelas novas com RLS ligado e NENHUMA policy: a chave publica
--   (a que esta no config.js) nao le nem grava nada aqui. So a Edge Function
--   telegram-bot, com a chave secreta, acessa. As funcoes de busca tambem
--   ficam fechadas para anon/authenticated.
--
-- REVERSIVEL: ver o bloco de rollback no fim.
-- =============================================================================

begin;

-- ---------------------------------------------------------------------------
-- 1. MOTIVOS - colunas de configuracao do bot
-- ---------------------------------------------------------------------------
alter table motivos_devolucao
  add column if not exists codigo               varchar(30),
  add column if not exists visivel_motorista    boolean  not null default false,
  add column if not exists min_fotos            smallint not null default 0,
  add column if not exists exige_canhoto        boolean  not null default true,
  add column if not exists exige_localizacao    boolean  not null default true,
  add column if not exists orientacao_fotos     text,
  add column if not exists ordem                smallint not null default 100;

create unique index if not exists uq_motivos_devolucao_codigo on motivos_devolucao(codigo);

-- Lista inicial - A VALIDAR COM O SAC. "nome" e o texto que o atendente vai
-- usar em ocorrencias_devolucao.motivo_reclamado (mesma grafia ja usada).
insert into motivos_devolucao
  (nome, ativo, codigo, visivel_motorista, min_fotos, exige_canhoto, exige_localizacao, orientacao_fotos, ordem)
values
  ('AVARIA',                        true, 'AVARIA',         true, 2, true,  true, 'do produto danificado e da embalagem', 10),
  ('FALTA DE MERCADORIA EXPEDIÇÃO', true, 'FALTA',          true, 0, true,  true, null,                                   20),
  ('SOBRA DE MERCADORIA',           true, 'SOBRA',          true, 1, true,  true, 'do produto que sobrou',                30),
  ('INVERSAO MERCADORIA EXPEDICAO', true, 'INVERSAO',       true, 1, true,  true, 'do produto e da etiqueta trocados',    40),
  ('DATA PROXIMA DA VALIDADE',      true, 'VALIDADE',       true, 1, true,  true, 'com a data de validade legivel',       50),
  ('QUEBRA DE PESO',                true, 'QUEBRA_PESO',    true, 1, true,  true, 'da balanca mostrando o peso',          60),
  ('CLIENTE RECUSOU / FECHADO',     true, 'RECUSA_FECHADO', true, 1, false, true, 'da fachada do cliente',                70),
  ('ERRO RCA',                      true, 'ERRO_PEDIDO',    true, 0, true,  true, null,                                   80),
  ('QUALIDADE DO PRODUTO',          true, 'QUALIDADE',      true, 2, true,  true, 'que mostrem o problema',               90),
  ('OUTROS',                        true, 'OUTROS',         true, 0, true,  true, null,                                  999)
on conflict (nome) do update set
  codigo            = excluded.codigo,
  visivel_motorista = excluded.visivel_motorista,
  min_fotos         = excluded.min_fotos,
  exige_canhoto     = excluded.exige_canhoto,
  exige_localizacao = excluded.exige_localizacao,
  orientacao_fotos  = excluded.orientacao_fotos,
  ordem             = excluded.ordem;

-- ---------------------------------------------------------------------------
-- 2. CONFIGURACAO DO BOT (nada secreto aqui; o token fica nos Secrets)
-- ---------------------------------------------------------------------------
create table bot_config (
  chave         text primary key,
  valor         text,
  atualizado_em timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- 3. VINCULO MOTORISTA <-> TELEGRAM
-- ---------------------------------------------------------------------------
create table motoristas_telegram (
  id                    bigint generated always as identity primary key,
  -- CASCADE de proposito: se o Jr-Oper apagar o motorista de vez (Lixeira),
  -- a exclusao nao pode travar por causa do bot.
  motorista_id          bigint not null references motoristas(id) on delete cascade,
  chat_id               bigint,
  telegram_user_id      bigint,
  telegram_username     text,
  codigo_vinculo        text unique,
  codigo_expira_em      timestamptz,
  vinculado_em          timestamptz,
  ativo                 boolean not null default true,
  revogado_em           timestamptz,
  revogado_por          text,
  -- solicitacao em "pendente_complemento" que o motorista esta respondendo
  solicitacao_ativa_id  bigint,
  criado_por            text,
  criado_em             timestamptz not null default now()
);
create unique index uq_mt_motorista_ativo on motoristas_telegram(motorista_id) where ativo;
create unique index uq_mt_chat_ativo      on motoristas_telegram(chat_id) where ativo and chat_id is not null;

-- ---------------------------------------------------------------------------
-- 4. SOLICITACAO DE DEVOLUCAO
-- ---------------------------------------------------------------------------
create sequence solicitacao_devolucao_seq;

create table solicitacoes_devolucao (
  id                        bigint generated always as identity primary key,
  protocolo                 text not null unique default
                              'TG-' || to_char(now() at time zone 'America/Sao_Paulo', 'YYYY') || '-' ||
                              lpad(nextval('solicitacao_devolucao_seq')::text, 4, '0'),
  status                    text not null default 'em_coleta' check (status in
                              ('em_coleta', 'aguardando_sac', 'pendente_complemento',
                               'ocorrencia_aberta', 'reprovada', 'cancelada', 'recebida_deposito')),
  etapa                     text,        -- pergunta atual enquanto em_coleta
  corrigindo                boolean not null default false,
  motorista_id              bigint references motoristas(id) on delete set null,
  motorista_nome            text not null,
  chat_id                   bigint not null,
  nota_fiscal               text,
  nf_duplicada_de           text,        -- protocolo de outra solicitacao com a mesma NF
  cliente_id                bigint references clientes(id) on delete set null,
  cliente_codigo            text,
  cliente_nome              text,
  cliente_cidade            text,
  motivo_codigo             varchar(30) references motivos_devolucao(codigo) on update cascade,
  tipo_devolucao            text check (tipo_devolucao in ('total', 'parcial')),
  observacoes               text,
  canhoto_justificativa     text,
  latitude                  numeric(9,6),
  longitude                 numeric(9,6),
  localizacao_justificativa text,
  numero_devolucao          text,        -- DEV informada pelo SAC ao abrir no Jr-Oper
  complemento_pedido        text,
  complemento_resposta      text,
  decisao_motivo            text,
  decidido_por              text,
  decidido_em               timestamptz,
  sac_message_id            bigint,      -- mensagem com os botoes no grupo do SAC
  enviado_sac_em            timestamptz,
  ultima_interacao_em       timestamptz not null default now(),
  criado_em                 timestamptz not null default now(),
  atualizado_em             timestamptz not null default now()
);
-- no maximo uma solicitacao sendo preenchida por motorista
create unique index uq_solicitacao_em_coleta on solicitacoes_devolucao(motorista_id) where status = 'em_coleta';
create index ix_solicitacao_status on solicitacoes_devolucao(status, enviado_sac_em);
create index ix_solicitacao_nf     on solicitacoes_devolucao(nota_fiscal);
create index ix_solicitacao_chat   on solicitacoes_devolucao(chat_id, criado_em desc);

create table solicitacao_itens (
  id             bigint generated always as identity primary key,
  solicitacao_id bigint not null references solicitacoes_devolucao(id) on delete cascade,
  texto          text not null,
  criado_em      timestamptz not null default now()
);
create index ix_itens_solicitacao on solicitacao_itens(solicitacao_id, id);

create table solicitacao_anexos (
  id                      bigint generated always as identity primary key,
  solicitacao_id          bigint not null references solicitacoes_devolucao(id) on delete cascade,
  tipo                    text not null check (tipo in
                            ('foto_produto', 'canhoto', 'audio', 'observacao', 'complemento')),
  midia                   text not null check (midia in ('photo', 'document', 'voice', 'audio', 'video')),
  telegram_file_id        text not null,
  telegram_file_unique_id text,
  media_group_id          text,
  storage_path            text,           -- copia no bucket privado (null se o download falhar)
  mime_type               text,
  tamanho_bytes           integer,
  enviado_sac             boolean not null default false,
  criado_em               timestamptz not null default now()
);
create index ix_anexos_solicitacao on solicitacao_anexos(solicitacao_id, tipo);
create index ix_anexos_grupo       on solicitacao_anexos(solicitacao_id, media_group_id);

create table solicitacao_historico (
  id              bigint generated always as identity primary key,
  solicitacao_id  bigint not null references solicitacoes_devolucao(id) on delete cascade,
  status_anterior text,
  status_novo     text,
  autor_tipo      text not null check (autor_tipo in ('motorista', 'sac', 'sistema')),
  autor_nome      text,
  comentario      text,
  criado_em       timestamptz not null default now()
);
create index ix_historico_solicitacao on solicitacao_historico(solicitacao_id, id);

-- "Responda a esta mensagem" no grupo do SAC
create table sac_acoes_pendentes (
  prompt_message_id  bigint primary key,
  solicitacao_id     bigint not null references solicitacoes_devolucao(id) on delete cascade,
  acao               text not null check (acao in ('abrir', 'complemento', 'reprovar')),
  telegram_user_id   bigint,
  telegram_user_nome text,
  criado_em          timestamptz not null default now(),
  concluida_em       timestamptz
);

-- O Telegram reenvia o webhook quando nao recebe resposta a tempo; o
-- update_id garante que a mesma mensagem nao e processada duas vezes.
create table telegram_updates (
  update_id     bigint primary key,
  chat_id       bigint,
  tipo          text,
  payload       jsonb not null,
  recebido_em   timestamptz not null default now(),
  processado_em timestamptz,
  erro          text
);
create index ix_tg_updates_recebido on telegram_updates(recebido_em);

-- ---------------------------------------------------------------------------
-- 5. MAQUINA DE ESTADOS - garantida pelo banco, nao so pelo codigo
-- ---------------------------------------------------------------------------
create or replace function fn_solicitacao_transicao() returns trigger
language plpgsql set search_path = public as $$
begin
  if new.status is distinct from old.status and not (
     (old.status, new.status) in (
       ('em_coleta',            'aguardando_sac'),
       ('em_coleta',            'cancelada'),
       ('aguardando_sac',       'pendente_complemento'),
       ('aguardando_sac',       'ocorrencia_aberta'),
       ('aguardando_sac',       'reprovada'),
       ('pendente_complemento', 'aguardando_sac'),
       ('pendente_complemento', 'ocorrencia_aberta'),
       ('pendente_complemento', 'reprovada'),
       ('ocorrencia_aberta',    'recebida_deposito'))) then
    raise exception 'Transicao de status invalida: % -> %', old.status, new.status
      using errcode = 'check_violation';
  end if;
  new.atualizado_em := now();
  return new;
end $$;

create trigger trg_solicitacao_transicao
  before update on solicitacoes_devolucao
  for each row execute function fn_solicitacao_transicao();

-- ---------------------------------------------------------------------------
-- 6. BUSCAS (sem acento, por palavras, em qualquer ordem)
-- ---------------------------------------------------------------------------
create or replace function fn_sem_acento(t text) returns text
language sql immutable set search_path = public as $$
  select upper(translate(coalesce(t, ''),
    'áàâãäéèêëíìîïóòôõöúùûüçÁÀÂÃÄÉÈÊËÍÌÎÏÓÒÔÕÖÚÙÛÜÇ',
    'aaaaaeeeeiiiiooooouuuucAAAAAEEEEIIIIOOOOOUUUUC'))
$$;

create or replace function bot_buscar_clientes(p_termo text, p_limite int default 6)
returns table (id bigint, codigo_cliente varchar, razao_social varchar, cidade varchar)
language sql stable set search_path = public as $$
  with t as (select trim(coalesce(p_termo, '')) as termo)
  select c.id, c.codigo_cliente, c.razao_social, c.cidade
  from clientes c, t
  where coalesce(c.is_deleted, false) = false
    and length(t.termo) > 0
    and (
      (t.termo ~ '^[0-9]+$' and c.codigo_cliente = t.termo)
      or
      (t.termo !~ '^[0-9]+$' and not exists (
         select 1 from unnest(string_to_array(fn_sem_acento(t.termo), ' ')) as w(palavra)
         where w.palavra <> ''
           and fn_sem_acento(c.razao_social) not like '%' || w.palavra || '%'))
    )
  order by c.razao_social
  limit p_limite
$$;

create or replace function bot_buscar_motoristas(p_termo text, p_limite int default 8)
returns table (id bigint, nome varchar)
language sql stable set search_path = public as $$
  select m.id, m.nome
  from motoristas m
  where coalesce(m.is_deleted, false) = false
    and coalesce(m.ativo, true)
    and length(trim(coalesce(p_termo, ''))) > 0
    and not exists (
      select 1 from unnest(string_to_array(fn_sem_acento(trim(p_termo)), ' ')) as w(palavra)
      where w.palavra <> ''
        and fn_sem_acento(m.nome) not like '%' || w.palavra || '%')
  order by m.nome
  limit p_limite
$$;

revoke execute on function fn_sem_acento(text)                 from public, anon, authenticated;
revoke execute on function bot_buscar_clientes(text, int)      from public, anon, authenticated;
revoke execute on function bot_buscar_motoristas(text, int)    from public, anon, authenticated;
revoke execute on function fn_solicitacao_transicao()          from public, anon, authenticated;
grant  execute on function fn_sem_acento(text)                 to service_role;
grant  execute on function bot_buscar_clientes(text, int)      to service_role;
grant  execute on function bot_buscar_motoristas(text, int)    to service_role;

-- ---------------------------------------------------------------------------
-- 7. SEGURANCA - RLS ligado e NENHUMA policy
-- ---------------------------------------------------------------------------
alter table bot_config             enable row level security;
alter table motoristas_telegram    enable row level security;
alter table solicitacoes_devolucao enable row level security;
alter table solicitacao_itens      enable row level security;
alter table solicitacao_anexos     enable row level security;
alter table solicitacao_historico  enable row level security;
alter table sac_acoes_pendentes    enable row level security;
alter table telegram_updates       enable row level security;

-- ---------------------------------------------------------------------------
-- 8. BUCKET PRIVADO (sem policy: so a chave secreta le e grava)
-- ---------------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('devolucoes-telegram', 'devolucoes-telegram', false, 20971520,
        array['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'application/pdf',
              'audio/ogg', 'audio/mpeg', 'audio/mp4', 'video/mp4'])
on conflict (id) do nothing;

commit;

-- =============================================================================
-- ROLLBACK (rodar manualmente se precisar desfazer)
-- =============================================================================
-- begin;
-- drop table if exists telegram_updates, sac_acoes_pendentes, solicitacao_historico,
--   solicitacao_anexos, solicitacao_itens, solicitacoes_devolucao,
--   motoristas_telegram, bot_config cascade;
-- drop sequence if exists solicitacao_devolucao_seq;
-- drop function if exists bot_buscar_clientes(text, int), bot_buscar_motoristas(text, int),
--   fn_sem_acento(text), fn_solicitacao_transicao();
-- drop index if exists uq_motivos_devolucao_codigo;
-- alter table motivos_devolucao drop column if exists codigo, drop column if exists visivel_motorista,
--   drop column if exists min_fotos, drop column if exists exige_canhoto,
--   drop column if exists exige_localizacao, drop column if exists orientacao_fotos,
--   drop column if exists ordem;
-- delete from motivos_devolucao where nome in ('AVARIA','FALTA DE MERCADORIA EXPEDIÇÃO',
--   'SOBRA DE MERCADORIA','INVERSAO MERCADORIA EXPEDICAO','DATA PROXIMA DA VALIDADE',
--   'QUEBRA DE PESO','CLIENTE RECUSOU / FECHADO','ERRO RCA','QUALIDADE DO PRODUTO','OUTROS');
-- commit;
-- O bucket precisa ser esvaziado e removido pelo painel (Storage).
