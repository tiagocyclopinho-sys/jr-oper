-- migration_79 (17/11/2026) - DEV-2026-023: foto em base64 sai do registro
--
-- A DEV-2026-023 esta na lixeira (is_deleted) e ainda carregava a mesma foto
-- duas vezes em base64 (foto_url + fotos_abertura, 255 KB), que descia para
-- todo aparelho. jrMigrarTodasFotosLegado() pula registro excluido, entao a
-- foto so sai por aqui. Copia fica em bkp_dev023_foto_base64 (fora da
-- sincronizacao, RLS ligado sem politica: o app nao le).
-- Carimbo em horario de Brasilia (ver CLAUDE.md, guarda de carimbo).

create table if not exists public.bkp_dev023_foto_base64 as
select id, numero_protocolo, foto_url, fotos_abertura, atualizado_em,
       (now() at time zone 'America/Sao_Paulo') as copiado_em
from public.ocorrencias_devolucao
where id = 1788201226527534;

alter table public.bkp_dev023_foto_base64 enable row level security;

update public.ocorrencias_devolucao
set foto_url = '',
    fotos_abertura = '[]'::jsonb,
    atualizado_em = (now() at time zone 'America/Sao_Paulo')
where id = 1788201226527534
  and exists (select 1 from public.bkp_dev023_foto_base64 b
              where b.id = 1788201226527534 and b.fotos_abertura is not null);
