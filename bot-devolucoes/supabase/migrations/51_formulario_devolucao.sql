-- =============================================================================
-- MIGRATION 51 - FORMULARIO DE DEVOLUCAO POR LINK (depende da 50)
--
-- O QUE FAZ
--   Permite que a mesma tabela solicitacoes_devolucao receba solicitacoes
--   vindas do formulario web (link enviado pelo WhatsApp do SAC), alem do
--   Telegram. Cria a coluna "origem", solta as colunas que so o Telegram
--   preenche e troca o prefixo do protocolo de TG- para SD-.
--
-- O QUE NAO FAZ
--   Nao toca em nenhuma tabela que o Jr-Oper sincroniza.
--
-- SEGURANCA
--   Continua tudo fechado (RLS sem policy). Quem le e grava e so a Edge
--   Function "formulario-devolucao", com a chave secreta. A senha do painel
--   do SAC fica em bot_config como hash SHA-256 (chave 'painel_sac_senha_sha256').
-- =============================================================================

begin;

alter table solicitacoes_devolucao
  add column if not exists origem            text not null default 'telegram'
                                             check (origem in ('telegram', 'formulario')),
  add column if not exists telefone_motorista text,
  add column if not exists usuario_agente     text;   -- navegador do motorista (diagnostico)

alter table solicitacoes_devolucao alter column chat_id drop not null;

alter table solicitacoes_devolucao alter column protocolo set default
  'SD-' || to_char(now() at time zone 'America/Sao_Paulo', 'YYYY') || '-' ||
  lpad(nextval('solicitacao_devolucao_seq')::text, 4, '0');

alter table solicitacao_anexos alter column telegram_file_id drop not null;
alter table solicitacao_anexos add column if not exists nome_original text;

-- Status sem trava extra: o formulario ja grava direto como 'aguardando_sac'
-- (a trava da 50 so age em UPDATE).

create index if not exists ix_solicitacao_origem on solicitacoes_devolucao(origem, criado_em desc);

commit;

-- =============================================================================
-- ROLLBACK
-- =============================================================================
-- begin;
-- drop index if exists ix_solicitacao_origem;
-- alter table solicitacao_anexos drop column if exists nome_original;
-- alter table solicitacoes_devolucao alter column protocolo set default
--   'TG-' || to_char(now() at time zone 'America/Sao_Paulo', 'YYYY') || '-' ||
--   lpad(nextval('solicitacao_devolucao_seq')::text, 4, '0');
-- alter table solicitacoes_devolucao drop column if exists usuario_agente,
--   drop column if exists telefone_motorista, drop column if exists origem;
-- commit;
-- (chat_id / telegram_file_id voltam a NOT NULL so se nao houver linhas do formulario)
