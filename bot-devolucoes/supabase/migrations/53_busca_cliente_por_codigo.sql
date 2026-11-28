-- 53 - Busca de cliente pelo codigo, do jeito que o motorista digita.
-- Substitui bot_buscar_clientes (migration 50). Usada pelo Telegram, pelo
-- WhatsApp e pelo formulario. So troca a funcao: nenhuma tabela muda.
--
-- Agora acha o cliente quando o motorista manda:
--   "45"                -> codigos curtos (antes o bot exigia 3 caracteres)
--   "0130", "12.345"    -> zeros a esquerda, ponto, traco ou espaco no meio
--   "cod 130", "cód: 130"
--   "130 - QUARTETTO"   -> codigo + nome copiados da nota; o codigo vem
--                          primeiro e o nome tambem e buscado, caso o codigo
--                          esteja errado
-- Os codigos no cadastro sao so numeros, sem zero a esquerda.

create or replace function bot_buscar_clientes(p_termo text, p_limite int default 6)
returns table (id bigint, codigo_cliente varchar, razao_social varchar, cidade varchar)
language sql stable set search_path = public as $$
  with t as (
    select regexp_replace(trim(coalesce(p_termo, '')),
             '^(c[oó]d(igo)?|cliente)\s*[.:ºo°]*\s*', '', 'i') as termo
  ), n as (
    select
      -- Termo todo numerico (ignorando ponto, traco, barra e espaco)
      case when regexp_replace(t.termo, '[\s./-]', '', 'g') ~ '^[0-9]+$'
           then nullif(ltrim(regexp_replace(t.termo, '[\s./-]', '', 'g'), '0'), '') end as codigo,
      -- Codigo no inicio seguido do nome: "130 - QUARTETTO"
      nullif(ltrim(substring(t.termo from '^([0-9]{1,6})\s*[-–:]?\s*[^0-9\s]'), '0'), '') as codigo_inicio,
      -- Palavras do nome: so as que tem letra
      array(select w from unnest(string_to_array(fn_sem_acento(t.termo), ' ')) as p(w)
            where w ~ '[A-Z]') as palavras
    from t
  )
  select c.id, c.codigo_cliente, c.razao_social, c.cidade
  from clientes c, n
  where coalesce(c.is_deleted, false) = false
    and (
      c.codigo_cliente = n.codigo
      or (n.codigo is null and c.codigo_cliente = n.codigo_inicio)
      or (n.codigo is null
          and length(array_to_string(n.palavras, '')) >= 3
          and not exists (
            select 1 from unnest(n.palavras) as w(palavra)
            where fn_sem_acento(c.razao_social) not like '%' || w.palavra || '%'))
    )
  order by (c.codigo_cliente = coalesce(n.codigo, n.codigo_inicio)) desc nulls last, c.razao_social
  limit p_limite
$$;

revoke execute on function bot_buscar_clientes(text, int) from public, anon, authenticated;
grant  execute on function bot_buscar_clientes(text, int) to service_role;
