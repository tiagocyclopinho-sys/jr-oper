-- =============================================================================
-- MIGRACAO 27 - A TRAVA DE destino_cd (23/08/2026)
--
-- SINTOMA RELATADO
-- Conferir o retorno fisico no CD pelo PC: o PC mostra resolvido, o celular
-- continua mostrando "1 Retorno(s) Pendente(s) CD" indefinidamente. Fazendo
-- o caminho inverso (apurar a causa raiz pelo celular), o celular atualiza e
-- o PC nao. Cada aparelho enxerga a propria acao e ignora a do outro.
--
-- CAUSA
-- A tela de destinacao do CD oferece SEIS destinos (js/app.js:8467-8472):
--     ESTOQUE_REUTILIZACAO, AVARIA_DESCARTE, DEVOLUCAO_FORNECEDOR,
--     RETRABALHO_REEMBALAGEM, PRODUTOS_NEGOCIACAO, RENEGOCIADO_ROTA
-- O destino do PRIMEIRO item vira o destino_cd da devolucao inteira
-- (js/app.js:8627 -> updateDestinoCd em store.js:1210).
-- A trava do banco, posta na migration_23, aceita so QUATRO: as duas
-- ultimas nao passam.
--
-- POR QUE ISSO PARA A TABELA INTEIRA, e nao so aquele registro
-- O envio do PostgREST e UMA transacao: um registro recusado derruba o lote
-- todo, inclusive os validos (esta escrito no cabecalho da migration_26). Ou
-- seja: a partir da primeira devolucao destinada a "Produtos para Negociacao"
-- ou "Renegociado em Rota", NENHUMA alteracao de devolucao daquele aparelho
-- sobe mais - nem aquela, nem as outras.
--
-- E POR QUE O OUTRO APARELHO TAMBEM PARA DE ATUALIZAR
-- O aparelho travado fica com uma alteracao local nao enviada naquele
-- registro. Na mesclagem, "os dois lados mudaram" resolve a favor do LOCAL
-- (regra de desempate deliberada, ver _mesclarPorRegistro). Como o envio
-- nunca vai passar, ele rejeita para sempre o que vem do outro aparelho
-- naquele registro. Dai o sintoma parecer ida E volta.
--
-- A DECISAO
-- Tirar a trava, e nao aumenta-la. E a mesma decisao ja tomada na
-- migration_26 para ocorrencias_viagens.status, e pelo mesmo motivo, dito
-- la: "um CHECK sobre vocabulario que o app nao respeita e exatamente o
-- mecanismo que produziu os 247 fantasmas em data_saida e o 23514 de
-- ocorrencias_rota. O app e o unico escritor."
--
-- Aumentar a lista para seis consertaria hoje e quebraria de novo no dia em
-- que alguem acrescentar um setimo <option> na tela - sem nenhum aviso, e
-- com o mesmo sintoma silencioso de agora.
--
-- Varri as outras oito colunas com trava de vocabulario comparando com o que
-- as telas oferecem: destino_cd e a unica com divergencia real. Os valores
-- VENDIDO, PENDENTE_INVESTIGACAO, RESOLVIDO e EM_TRANSITO aparecem em
-- <option>, mas em filtros de relatorio e em itens_devolucao.destino_item,
-- que nao tem trava. Nenhum deles chega a uma coluna travada.
--
-- Rode este arquivo inteiro no SQL Editor do Supabase. E idempotente:
-- rodar duas vezes nao faz diferenca.
-- =============================================================================

BEGIN;

ALTER TABLE ocorrencias_devolucao
  DROP CONSTRAINT IF EXISTS ocorrencias_devolucao_destino_cd_check;

COMMIT;

-- -----------------------------------------------------------------------
-- CONFERENCIA (opcional). Depois de rodar, isto tem que voltar VAZIO:
--
--   SELECT conname
--     FROM pg_constraint
--    WHERE conrelid = 'ocorrencias_devolucao'::regclass
--      AND conname  = 'ocorrencias_devolucao_destino_cd_check';
--
-- E, para ver os destinos que ja existem gravados:
--
--   SELECT destino_cd, count(*)
--     FROM ocorrencias_devolucao
--    WHERE is_deleted IS NOT TRUE
--    GROUP BY destino_cd
--    ORDER BY 2 DESC;
-- -----------------------------------------------------------------------

-- DEPOIS DE RODAR, NOS APARELHOS
-- O que ficou preso sobe sozinho no proximo ciclo de 30 segundos - o envio
-- recusado nunca foi marcado como confirmado, entao continua na fila. Para
-- conferir sem esperar: Governanca & Lixeira -> Aparelhos -> "Ver o motivo"
-- (deve parar de listar ocorrencias_devolucao) e depois "Conferir as copias".
