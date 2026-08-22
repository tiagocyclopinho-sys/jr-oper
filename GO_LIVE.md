# Go-Live — JR Oper

Procedimento para colocar o sistema em operação real com a sincronização
funcionando. Escrito em 21/08/2026, após o diagnóstico da causa raiz de
"os dados não compartilham".

**Tempo total: ~20 minutos.** Faça na ordem. Não pule o passo 2.

---

## Antes de começar

Tenha aberto:
- O painel do Supabase (projeto `qxipgnkdbzxtfvuyupow`)
- O painel da Vercel ou Netlify (onde o app está publicado)
- Dois aparelhos diferentes para o teste final (ex: PC e celular)

---

## PASSO 1 — Atualizar o banco (Supabase)

1. Supabase → menu lateral → **SQL Editor** → **New Query**
2. Abra `database/migration_22_fix_sync.sql`, copie **todo** o conteúdo e cole
3. Clique em **Run**
4. Deve aparecer `Success. No rows returned`

O script é idempotente: se rodar duas vezes, não quebra nada.

> **Por que:** o banco não tinha 8 colunas que o app grava, tinha `NOT NULL`
> em campos que o app deixa vazios, e tinha chaves estrangeiras que o modelo
> de sincronização não consegue respeitar. Era isso que fazia o Supabase
> recusar todo registro de devolução, rota, auditoria e resumo do CD.

## PASSO 2 — Confirmar que o banco aceitou (NÃO PULE)

Ainda no SQL Editor, rode:

```sql
SELECT
  (SELECT count(*) FROM information_schema.columns
    WHERE table_name='ocorrencias_devolucao'
      AND column_name IN ('motorista_id','fotos_investigacao','itens',
                          'atualizado_por','data_entrada_cd','requisito')) AS colunas_devolucao,
  (SELECT count(*) FROM information_schema.columns
    WHERE table_name='resumo_diario_cd'
      AND column_name IN ('recebimento','expedicao')) AS colunas_resumo;
```

**Resultado esperado: `colunas_devolucao = 6` e `colunas_resumo = 2`.**

Se vier número menor, o script não rodou inteiro — rode de novo e leia a
mensagem de erro antes de seguir.

## PASSO 3 — Publicar o app atualizado

Arraste a pasta `jr-sac-corrigido` para a Vercel/Netlify, como no deploy
original, e aguarde o "Deploy concluído".

Arquivos alterados nesta correção:
- `js/cloudStore.js` — ordem de envio, proteção contra perda de dado, erro visível
- `database/schema.sql` — correção incorporada (instalação nova nasce certa)
- `sw.js` — versão de cache `v4.7.3` → `v4.7.4`

## PASSO 4 — Limpar o cache em cada aparelho

O app é um PWA: sem isso, o aparelho continua rodando o JavaScript antigo e
nada muda, por mais que você publique.

- **PC:** abrir o site e pressionar `Ctrl + Shift + R`
- **Celular:** fechar a aba do app, reabrir, puxar a tela para baixo para recarregar

Faça em **todos** os aparelhos que vão operar.

## PASSO 5 — Zerar os dados de treinamento

Ainda há dados de teste no banco. Decida o que é real antes de abrir a operação:

| Tabela | Linhas hoje | Provavelmente |
|---|---|---|
| `veiculos` | 89 | frota real — **manter** |
| `ajudantes` | 38 | equipe real — **manter** |
| `controle_viagens` | 15 | treinamento — avaliar |
| `usuarios` | 8 | avaliar um a um |
| `motoristas` | 2 | avaliar |
| `cargas` | 1 | treinamento |

Em **um único aparelho**, use **Reset Global de Treinamento** no app. Ele agora
limpa local **e** nuvem, e preserva os cadastros mestre (motoristas, veículos,
ajudantes, clientes, usuários).

Depois do reset, recarregue os outros aparelhos (`Ctrl + Shift + R`) para eles
receberem o estado limpo.

## PASSO 6 — Teste de aceite (obrigatório, 5 minutos)

Com dois aparelhos, na mesma conta ou em contas diferentes:

1. No **aparelho A**: abra uma Devolução SAC completa, com item e foto
2. Confira o indicador no cabeçalho: deve estar **🟢 Nuvem Ativa**
   - Se aparecer **🔴 Dados NÃO salvos na nuvem**, PARE. Passe o mouse em cima
     para ler o erro, ou abra o console (F12) e rode `jrDiagnosticoSync()`
3. Aguarde até 40 segundos
4. No **aparelho B**: recarregue. A devolução deve aparecer
5. No aparelho B, faça o Retorno Físico dessa mesma devolução
6. No aparelho A: recarregue. A alteração deve aparecer

Se os 6 passos passarem, a sincronização está funcionando de verdade.

---

## Decisões que ficaram em aberto

### 1. Badge "Modo Treinamento"

`js/config.js` tem `dataInicioProducao: "2026-08-26"`. Se a operação real começa
antes disso, o cabeçalho vai exibir "🧪 Modo Treinamento" — é só informativo, não
bloqueia nada, mas confunde. Ajuste a data para o dia real de início.

### 2. Segurança do banco (tratar na primeira semana)

A policy atual é `FOR ALL TO anon USING (true)` e a chave está no JavaScript
público. Na prática: **qualquer pessoa com o endereço do site pode ler, alterar
e apagar o banco inteiro**, sem senha. A senha de administrador do app protege
as telas, não o banco.

Isso não impede o go-live, mas precisa entrar no plano — o caminho é Supabase
Auth com policies por usuário, substituindo o acesso anônimo.

### 3. Edição simultânea

A sincronização é por tabela inteira, a cada 30 segundos, e vale o último que
gravou. Se duas pessoas editarem **a mesma devolução** dentro da mesma janela de
30s, uma sobrescreve a outra sem aviso. Para o volume atual isso é aceitável;
vale combinar com a equipe que cada ocorrência tem um dono.

---

## Se algo der errado amanhã

O sistema **não perde dados** por falta de sincronização: tudo é gravado no
aparelho primeiro. Se a nuvem recusar, o dado continua lá e o indicador fica
vermelho.

1. Indicador vermelho → F12 → `jrDiagnosticoSync()` → mostra a tabela e o erro exato
2. Erro com `PGRST204` → falta uma coluna no banco; a mensagem diz qual
3. Erro com `23503` → chave estrangeira; a migração 22 deveria ter removido
4. Erro `401` / `403` → chave ou policy do Supabase

Enquanto isso, a operação continua normalmente em cada aparelho — só não
compartilha até resolver.
