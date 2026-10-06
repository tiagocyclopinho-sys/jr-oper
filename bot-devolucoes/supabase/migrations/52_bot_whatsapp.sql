-- =============================================================================
-- MIGRATION 52 - BOT DE DEVOLUCOES NO WHATSAPP (depende da 50 e da 51)
--
-- O QUE FAZ
--   Prepara as tabelas do bot para receber conversas do WhatsApp (coexistencia
--   via Dualhook): vinculo motorista <-> numero, registro dos eventos recebidos
--   (para nao processar a mesma mensagem duas vezes) e o modo simulacao.
--
-- O QUE NAO FAZ
--   Nao toca em nenhuma tabela que o Jr-Oper sincroniza.
--   Mensagens de quem nao e motorista NAO sao gravadas (so o id, sem conteudo,
--   quando a mensagem dispara o bot).
--
-- SEGURANCA
--   RLS ligado e nenhuma policy, como nas migrations 50 e 51. So a Edge
--   Function whatsapp-bot, com a chave secreta, le e grava.
--   Configuracao (nada secreto e reaproveitavel fora daqui) em bot_config:
--     wa_webhook_chave   -> parte da URL do webhook (?k=...)
--     wa_verify_token    -> token da verificacao GET da Meta
--     wa_phone_number_id -> numero autorizado (vazio = aceita o do teste)
--     wa_waba_id         -> conta autorizada  (vazio = aceita o do teste)
--   A chave do Dualhook (dh_live_...) fica nos Secrets da funcao: DUALHOOK_KEY.
--   Sem ela, o bot roda em MODO SIMULACAO e grava as respostas em
--   whatsapp_saida_simulada em vez de enviar.
-- =============================================================================

begin;

-- ---------------------------------------------------------------------------
-- 1. Solicitacao: origem whatsapp
-- ---------------------------------------------------------------------------
alter table solicitacoes_devolucao drop constraint if exists solicitacoes_devolucao_origem_check;
alter table solicitacoes_devolucao add constraint solicitacoes_devolucao_origem_check
  check (origem in ('telegram', 'formulario', 'whatsapp'));
alter table solicitacoes_devolucao add column if not exists wa_id text;
create index if not exists ix_solicitacao_wa on solicitacoes_devolucao(wa_id, criado_em desc);

alter table solicitacao_anexos add column if not exists whatsapp_media_id text;

-- ---------------------------------------------------------------------------
-- 2. Vinculo motorista <-> numero do WhatsApp
--    telefone_chave = DDD + 8 ultimos digitos (sem o 9 extra), para casar o
--    numero com e sem o 9, ja que a Meta as vezes manda sem.
-- ---------------------------------------------------------------------------
create table if not exists motoristas_whatsapp (
  id                    bigint generated always as identity primary key,
  motorista_id          bigint not null references motoristas(id) on delete cascade,
  wa_id                 text not null,
  telefone_chave        text not null,
  nome_perfil           text,
  ativo                 boolean not null default true,
  primeiro_uso          boolean not null default true,  -- SAC ainda nao viu uma solicitacao deste numero
  solicitacao_ativa_id  bigint,                         -- complemento em andamento
  vinculado_em          timestamptz not null default now(),
  revogado_em           timestamptz,
  revogado_por          text
);
create unique index if not exists uq_mw_tel_ativo on motoristas_whatsapp(telefone_chave) where ativo;

-- Cadastro em andamento (motorista ainda escolhendo o nome)
create table if not exists whatsapp_cadastro (
  telefone_chave text primary key,
  wa_id          text not null,
  etapa          text not null default 'nome',
  criado_em      timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- 3. Eventos recebidos (idempotencia). So guarda o conteudo de quem esta
--    falando com o bot; o resto nem entra aqui.
-- ---------------------------------------------------------------------------
create table if not exists whatsapp_eventos (
  mensagem_id   text primary key,      -- wamid
  campo         text not null,         -- messages | smb_message_echoes
  wa_id         text,
  tipo          text,
  payload       jsonb,
  recebido_em   timestamptz not null default now(),
  processado_em timestamptz,
  erro          text
);
create index if not exists ix_wa_eventos_recebido on whatsapp_eventos(recebido_em);

-- ---------------------------------------------------------------------------
-- 4. Modo simulacao (sem chave do Dualhook): o que o bot teria enviado
-- ---------------------------------------------------------------------------
create table if not exists whatsapp_saida_simulada (
  id        bigint generated always as identity primary key,
  para      text not null,
  corpo     jsonb not null,
  criado_em timestamptz not null default now()
);

alter table motoristas_whatsapp     enable row level security;
alter table whatsapp_cadastro       enable row level security;
alter table whatsapp_eventos        enable row level security;
alter table whatsapp_saida_simulada enable row level security;

commit;

-- =============================================================================
-- ROLLBACK
-- =============================================================================
-- begin;
-- drop table if exists whatsapp_saida_simulada, whatsapp_eventos, whatsapp_cadastro, motoristas_whatsapp;
-- alter table solicitacao_anexos drop column if exists whatsapp_media_id;
-- drop index if exists ix_solicitacao_wa;
-- alter table solicitacoes_devolucao drop column if exists wa_id;
-- (restaurar o check de origem so se nao houver linhas 'whatsapp')
-- commit;
