-- =============================================================================
-- 00 - ESPELHO MINIMO DA PRODUCAO  --  RODAR SOMENTE NO PROJETO DE TESTE
--
-- Cria, com as MESMAS colunas da producao (JR-OPER, consultado em 30/09/2026),
-- as tres tabelas de cadastro que o bot le. Assim o codigo da Edge Function e
-- identico nos dois ambientes.
--
-- NUNCA rodar em producao: la estas tabelas ja existem e sao do Jr-Oper.
-- Diferenca proposital: aqui nao existe a policy "acesso_total_anon".
-- =============================================================================

create table if not exists motoristas (
  id                    bigserial primary key,
  nome                  varchar(120) not null,
  cnh                   varchar(20),
  telefone              varchar(20),
  ativo                 boolean default true,
  is_deleted            boolean default false,
  deleted_at            timestamp,
  deleted_by_usuario_id bigint,
  deleted_by_nome       varchar(120),
  data_admissao         date,
  data_desligamento     date
);

create table if not exists clientes (
  id                    bigserial primary key,
  codigo_cliente        varchar(30),
  razao_social          varchar(150),
  cnpj                  varchar(20),
  cidade                varchar(80),
  uf                    varchar(2),
  is_deleted            boolean default false,
  deleted_at            timestamp,
  deleted_by_usuario_id bigint,
  deleted_by_nome       varchar(120),
  atualizado_em         timestamptz default now()
);

create table if not exists motivos_devolucao (
  nome      varchar(160) primary key,
  ativo     boolean default true,
  criado_em timestamp default (now() at time zone 'America/Sao_Paulo')
);

alter table motoristas        enable row level security;
alter table clientes          enable row level security;
alter table motivos_devolucao enable row level security;
