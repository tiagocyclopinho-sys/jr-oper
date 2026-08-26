-- =============================================================================
-- MIGRATION 35 - EXCLUSAO DE VIDEO DE EVIDENCIA PELO APP
--
-- NAO APLICADA AINDA. Precisa rodar no projeto qxipgnkdbzxtfvuyupow para que o
-- botao de excluir midia (js/app.js, confirmarExclusaoMidia) consiga de fato
-- apagar o arquivo. Sem ela o app continua funcionando, mas avisa na tela que
-- o arquivo permaneceu no servidor - ver o comentario em
-- js/fotoStore.js -> window.jrExcluirObjetoStorage.
--
-- POR QUE ELA EXISTE
-- Ate 26/08/2026 a midia da ocorrencia era so-acrescimo: nao havia nenhum
-- caminho no app que removesse uma foto ou um video. Anexou o arquivo errado,
-- conviveu com ele para sempre - e o volume so subia, em tres lugares ao mesmo
-- tempo (bucket, JSONB que volta no select=* a cada 30 segundos, cota de
-- localStorage de cada aparelho). O acumulo foi apontado pela operacao como
-- problema real, e a decisao tomada no mesmo dia foi: exclusao definitiva,
-- liberada para todos os perfis, com registro obrigatorio de quem excluiu.
--
-- O QUE ISTO REVERTE, E POR QUE E COERENTE
-- A migration 34 criou o bucket reentregas-fotos SEM policy de DELETE, e
-- escreveu o motivo: "foto de recepcao e prova operacional, e apagar nao pode
-- ser um clique". Aquele raciocinio CONTINUA VALENDO e por isso o bucket
-- reentregas-fotos NAO e tocado aqui - a foto de recepcao do CD e prova de
-- entrega, tem valor contratual, e ninguem pediu para apaga-la.
--
-- O que muda e so o bucket evidencias-videos, que e outra coisa: video anexado
-- pelo SAC na abertura e na analise de uma devolucao, para ilustrar a
-- reclamacao. E o unico onde o operador anexa e frequentemente erra (video
-- trocado, video do cliente errado, 40 MB de gravacao inutil), e o unico com
-- teto de 50 MB por arquivo - o que faz o acumulo pesar de verdade.
--
-- A garantia que substitui a policy ausente NAO e tecnica, e de rastro:
-- store.js -> excluirMidiaDevolucao() grava em audit_logs quem excluiu, quando,
-- de qual protocolo, qual item e quantos sobraram, ANTES de o arquivo sair.
-- Uma exclusao indevida fica atribuida a uma pessoa com nome e hora.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- POLICY DE DELETE - SOMENTE evidencias-videos
-- -----------------------------------------------------------------------------
-- Conferido no banco de producao em 26/08/2026: storage.objects tinha apenas
-- evidencias_videos_select_anon, evidencias_videos_insert_anon,
-- reentregas_fotos_select_anon e reentregas_fotos_insert_anon. Ausencia de
-- policy = negado, entao a chave anon levava 403 AccessDenied no DELETE.
drop policy if exists "evidencias_videos_delete_anon" on storage.objects;
create policy "evidencias_videos_delete_anon"
  on storage.objects for delete
  to anon, authenticated
  using (bucket_id = 'evidencias-videos');

-- DELIBERADAMENTE AUSENTE: policy de DELETE para 'reentregas-fotos'. Ver o
-- bloco "O QUE ISTO REVERTE" acima. Se um dia for preciso, que seja uma
-- migration propria, com a sua propria justificativa escrita.

-- -----------------------------------------------------------------------------
-- CONFERENCIA
-- -----------------------------------------------------------------------------
-- Depois de aplicar, isto tem de devolver exatamente 5 linhas, sendo a nova a
-- unica com cmd = 'DELETE':
--
--   select policyname, cmd from pg_policies
--    where schemaname = 'storage' and tablename = 'objects'
--    order by policyname;
