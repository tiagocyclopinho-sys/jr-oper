-- =============================================================================
-- LIMPEZA INICIAL DA "DESTINACAO DE ITENS" DO CD
--
-- STATUS: EXECUTADO em 18/09/2026 as 09:15 (Brasilia), projeto
-- qxipgnkdbzxtfvuyupow, apos alinhamento com o supervisor do CD (secao 2).
-- Resultado: 111 itens marcados, 0 ativos em RECEBIDO_CD, 16 itens / 13
-- devolucoes PENDENTE_FISICO intactos. Fotografia de seguranca gravada em
-- bkp_itens_devolucao_limpeza_20260918 (111 linhas) - apagar quando nao
-- precisar mais. A secao 7 continua valendo para desfazer.
--
-- Este arquivo fica como registro do que foi feito e como modelo, caso o CD
-- peca outra limpeza no futuro (ajustar data, marca e v_esperado).
--
-- NAO E MIGRATION. Nao roda no deploy. Roda UMA VEZ, com gente olhando, num
-- horario em que ninguem do CD esteja editando itens.
--
-- Preparado em 18/09/2026 a partir do levantamento feito no banco no mesmo dia.
--
-- -----------------------------------------------------------------------------
-- 1. O QUE E A ABA E O QUE ESTE ARQUIVO FAZ
--
-- "Destinacao de Itens (111)" e montada por getItensDestinadosFiltrados()
-- (js/app.js ~8989): entram os itens_devolucao cujas devolucoes ja tem
-- destino_cd (status RECEBIDO_CD) mais os itens avulsos. Medido em 18/09/2026:
--
--     itens de devolucoes RECEBIDO_CD ........ 111   <- e o que a tela mostra
--     itens de devolucoes PENDENTE_FISICO ....  16   (13 devolucoes) NAO entram
--     itens avulsos ativos ...................   0
--     devolucoes RECEBIDO_CD .................  59
--
-- O pedido do CD e comecar a Destinacao do zero. Este arquivo esvazia a aba
-- marcando os 111 itens com LAPIDE (is_deleted = true) - exatamente o que o
-- botao "Excluir" da tela faz, um por um (excluirItemDestino, js/app.js ~9668):
--
--     raw.is_deleted = true;
--     raw.deleted_at = agoraIsoBrasilia();
--     db.carimbarEdicao('itens_devolucao', raw);   // atualizado_em
--
-- POR QUE LAPIDE E NAO DELETE
--
--   a) Sincronizacao. O merge do cloudStore desempata local x nuvem por
--      atualizado_em. Lapide com carimbo novo vence em qualquer aparelho, mesmo
--      num celular que editou o item offline e ainda nao subiu. DELETE fisico
--      funciona para quem ja sincronizou; um aparelho que tenha o item sem
--      te-lo confirmado na nuvem o REENVIARIA, e o item voltaria.
--   b) Reversivel. is_deleted = false devolve tudo (secao 6).
--   c) Rastro. deleted_by_nome recebe a marca 'LIMPEZA INICIAL CD 18/09/2026',
--      entao da para separar depois o que foi limpeza do que foi exclusao de
--      operacao.
--
-- O QUE NAO E TOCADO
--
--   - ocorrencias_devolucao: as 59 recebidas continuam recebidas, com destino,
--     status de gestao, protocolo, fotos, etc.
--   - os 16 itens das 13 devolucoes PENDENTE_FISICO: quando o CD conferir a
--     entrada delas, os itens entram na Destinacao normalmente.
--   - itens_avulsos_destinacao: nao ha ativos.
--
-- -----------------------------------------------------------------------------
-- 2. DECISOES ALINHADAS COM O SUPERVISOR (18/09/2026)
--
--   [x] 2.1  Limpeza total (este SQL). Os itens serao redestinados como avulsos.
--            Alternativa descartada: correcao item a item pela tela.
--            - Este SQL: 111 itens somem da aba de uma vez; item relancado
--              depois como AVULSO perde o vinculo com protocolo / cliente /
--              motorista (na tela aparece "AVULSO").
--            - Pela tela (botao Editar em cada item, corrigindo o destino):
--              mesmo trabalho (111 cliques), mas mantem o vinculo com o
--              protocolo e nao gera lapide. Se o problema for so destino
--              errado, esta e a opcao que preserva historico.
--
--   [x] 2.2  Aceito. Aceitam que as 59 devolucoes recebidas passem a aparecer como
--            "Sem itens" na lista de Conferencia & Entrada e no detalhe da
--            devolucao? A lista de produtos continua no banco, so oculta.
--
--   [x] 2.3  Ciente; quem cuida do BI avisado. Power BI: itens_devolucao passa a ter 111 linhas com
--            is_deleted = true. Hoje a unica view que le a tabela e
--            vw_bi_controle_cd_pendencias (schema_views.sql ~81), que filtra
--            status_fechamento = 'PENDENTE_FISICO' - ou seja, os 111 nao
--            entram nela por acidente, nao por desenho. Qualquer view ou
--            consulta nova sobre itens_devolucao precisa de
--            coalesce(is_deleted,false) = false, senao soma em dobro.
--            Quem cuida do Power BI precisa saber.
--
--   [x] 2.4  "O quanto antes, para migrar a informacao" - rodado 18/09 09:15. Janela: dia e hora em que ninguem do CD esta editando itens.
--            No proximo sync de cada aparelho a aba esvazia sozinha.
--
--   [x] 2.5  Mantida. Marca de rastro: manter 'LIMPEZA INICIAL CD 18/09/2026' ou trocar
--            a data pela do dia em que rodar (ajustar nas secoes 4, 5 e 6).
--
-- -----------------------------------------------------------------------------
-- 3. CONFERENCIA ANTES (esperado: 111 itens, 59 devolucoes)
--
-- Se a contagem mudou desde 18/09, PARE e entenda por que antes de seguir.
-- Se o CD recebeu mais devolucoes nesse meio tempo, o numero sobe - e a
-- limpeza vai levar esses itens novos junto. Confirmar se e isso que querem.

select count(*)                                as itens,
       count(distinct i.ocorrencia_devolucao_id) as devolucoes
  from itens_devolucao i
  join ocorrencias_devolucao d on d.id = i.ocorrencia_devolucao_id
 where coalesce(i.is_deleted,false) = false
   and coalesce(d.is_deleted,false) = false
   and d.status_fechamento = 'RECEBIDO_CD';

-- Lista nominal, para o supervisor bater com o que ve na tela antes de apagar:
select d.numero_devolucao, d.numero_protocolo, d.destino_cd,
       p.codigo_produto, p.descricao, i.quantidade, i.destino_item,
       i.atualizado_em
  from itens_devolucao i
  join ocorrencias_devolucao d on d.id = i.ocorrencia_devolucao_id
  left join produtos p on p.id = i.produto_id
 where coalesce(i.is_deleted,false) = false
   and coalesce(d.is_deleted,false) = false
   and d.status_fechamento = 'RECEBIDO_CD'
 order by d.numero_devolucao, p.codigo_produto;

-- -----------------------------------------------------------------------------
-- 4. FOTOGRAFIA DE SEGURANCA (opcional, barata)
--
-- A lapide ja e reversivel (secao 6), mas uma copia crua custa nada e protege
-- de alguem apagar de verdade no futuro. Apagar esta tabela quando nao precisar
-- mais.

-- create table bkp_itens_devolucao_limpeza_20260918 as
-- select i.*
--   from itens_devolucao i
--   join ocorrencias_devolucao d on d.id = i.ocorrencia_devolucao_id
--  where coalesce(i.is_deleted,false) = false
--    and coalesce(d.is_deleted,false) = false
--    and d.status_fechamento = 'RECEBIDO_CD';

-- -----------------------------------------------------------------------------
-- 5. A LAPIDE (mesma regra do botao Excluir do app)
--
-- Roda dentro de um bloco que CONTA as linhas afetadas e DESFAZ sozinho se o
-- numero nao for o esperado. Ajuste v_esperado para o valor conferido na
-- secao 3 no dia da execucao.
--
-- Carimbo: as colunas sao TIMESTAMP sem fuso e guardam horario de BRASILIA
-- (migration 29 + agoraIsoBrasilia() no app). Por isso
-- now() AT TIME ZONE 'America/Sao_Paulo', e nao now() puro - now() puro
-- gravaria UTC, 3h adiantado, e ficaria incoerente com o resto da tabela.
-- Como o merge desempata por atualizado_em, o carimbo novo garante que a
-- lapide vence em todo aparelho.

-- do $$
-- declare
--   v_esperado  int := 111;
--   v_afetadas  int;
--   v_agora     timestamp := (now() at time zone 'America/Sao_Paulo');
-- begin
--   update itens_devolucao i
--      set is_deleted      = true,
--          deleted_at      = v_agora,
--          deleted_by_nome = 'LIMPEZA INICIAL CD 18/09/2026',
--          atualizado_em   = v_agora
--     from ocorrencias_devolucao d
--    where d.id = i.ocorrencia_devolucao_id
--      and coalesce(i.is_deleted,false) = false
--      and coalesce(d.is_deleted,false) = false
--      and d.status_fechamento = 'RECEBIDO_CD';
--
--   get diagnostics v_afetadas = row_count;
--
--   if v_afetadas <> v_esperado then
--     raise exception 'Esperava % itens, o UPDATE tocaria %. Nada foi gravado.',
--                     v_esperado, v_afetadas;
--   end if;
--
--   raise notice 'Lapide aplicada em % itens.', v_afetadas;
-- end $$;

-- -----------------------------------------------------------------------------
-- 6. CONFERENCIA DEPOIS
--
-- 6.1 No banco (esperado: 0 ativos; 111 com a marca)

select
  count(*) filter (where coalesce(i.is_deleted,false) = false)            as ativos,
  count(*) filter (where i.deleted_by_nome = 'LIMPEZA INICIAL CD 18/09/2026') as marcados
  from itens_devolucao i
  join ocorrencias_devolucao d on d.id = i.ocorrencia_devolucao_id
 where coalesce(d.is_deleted,false) = false
   and d.status_fechamento = 'RECEBIDO_CD';

-- 6.2 No app: abrir num aparelho com rede, esperar o sync, conferir que
--     "Destinacao de Itens" mostra (0) e que Conferencia & Entrada continua
--     com as 59 recebidas (agora "Sem itens") e as 13 pendentes intactas.

-- -----------------------------------------------------------------------------
-- 7. SE ALGUEM SE ARREPENDER
--
-- Desfaz SO o que esta limpeza marcou - exclusoes feitas pela tela, antes ou
-- depois, tem outro deleted_by_nome e ficam como estao. O carimbo novo em
-- atualizado_em faz a volta vencer em todo aparelho, pelo mesmo motivo da ida.

-- update itens_devolucao
--    set is_deleted      = false,
--        deleted_at      = null,
--        deleted_by_nome = null,
--        atualizado_em   = (now() at time zone 'America/Sao_Paulo')
--  where deleted_by_nome = 'LIMPEZA INICIAL CD 18/09/2026';
