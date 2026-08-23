# Passo a passo — Menu agrupado, Departamentos, base zerada e Reset Global

Entrega de 23/08/2026. **Tempo total: ~30 minutos.** Faça na ordem.
O passo 4 é o que costuma ser pulado — e é o que faz o resto valer.

O que muda nesta entrega:
- menu reorganizado por departamento, filtrado por papel, com "ver todas as telas"
- departamento vira **cadastro do admin**, dentro de "Logins e Senhas"
- **a área de Administração passa a exigir a senha de admin** — nas quatro telas,
  não só em "Logins e Senhas"
- **todos os usuários da produção são apagados** — cada pessoa se cadastra no
  primeiro acesso, e o papel vem do departamento que ela escolher
- Reset Global para zerar o dado operacional de teste

---

## Antes de começar

Tenha aberto:
- Painel do Supabase (projeto `qxipgnkdbzxtfvuyupow`) → **SQL Editor**
- Painel da Vercel/Netlify
- A senha de administrador (a que está no `js/config.js`)
- A lista de quais aparelhos vão operar — **todos** precisam do passo 4

**Feche o app em todos os aparelhos** antes do passo 1. Aparelho aberto
sincroniza a cada 30s e pode reenviar usuário antigo no meio da limpeza.

---

## PASSO 1 — Criar a tabela de departamentos

Supabase → SQL Editor → New Query → colar o arquivo inteiro → **Run**:

```
database/migration_26_departamentos.sql
```

É idempotente. Cria a tabela `departamentos` e semeia os 19 (a união das duas
listas que existiam fixas no código).

**Confira:**

```sql
SELECT role, count(*), string_agg(nome, ', ' ORDER BY nome)
  FROM departamentos WHERE ativo GROUP BY role ORDER BY role;
```

Esperado: **19 no total**, com `GERÊNCIA GERAL`, `GERÊNCIA OPERACIONAL` e
`SUPERVISÃO` como **GESTOR** — são os que hoje caem em SAC por falha de
comparação entre as duas listas.

---

## PASSO 2 — Zerar os usuários

Arquivo: `database/limpeza_usuarios.sql`. Ele tem **três blocos** — rode um de
cada vez, não o arquivo inteiro de uma vez.

1. **Bloco 1** — lista os usuários atuais. Olhe antes de apagar.
2. **Bloco 2** — zera as 17 referências de chave estrangeira e apaga os
   usuários. (Um `DELETE FROM usuarios` puro falha: `separador_id`,
   `gestor_id`, `criado_por_usuario_id` e o `deleted_by_usuario_id` de quase
   todo cadastro apontam para lá.)
3. **Bloco 3** — confere. Tem que dar `usuarios_restantes = 0`, com
   motoristas/ajudantes/veículos **intactos**.

> Este script **não** apaga dado operacional. Isso é o passo 7.

---

## PASSO 3 — Publicar o app

Arraste a pasta `jr-sac-corrigido` para a Vercel/Netlify, como sempre.

Arquivos alterados nesta entrega:
- `js/app.js` — menu agrupado, cadastro de departamentos, portão de senha da Administração
- `js/store.js` — CRUD de departamentos e migração da lista antiga
- `js/cloudStore.js` — `departamentos` entra no envio e na leitura
- `sw.js` — cache `v4.8.2` → **`v4.8.3`**
- `database/migration_26_departamentos.sql`, `database/limpeza_usuarios.sql`

---

## PASSO 4 — Limpar o cache de CADA aparelho

> ⚠️ **Não pule.** Apagar na nuvem não basta: um aparelho com os usuários
> antigos em cache os reenvia no ciclo seguinte de 30s. Foi assim que a
> DEV-2026-001 e as 15 viagens voltaram em 22/08 depois do Reset Global.

São duas coisas diferentes, e uma não faz a outra:

**4a. Atualizar o código** (o PWA guarda o JavaScript antigo)
- PC: abrir o site e `Ctrl + Shift + R`
- Celular: fechar a aba do app, reabrir, puxar a tela para baixo

**4b. Apagar os usuários locais** — `Ctrl + Shift + R` **não** limpa isso.
No PC, abra o console (F12) e cole:

```js
const d = JSON.parse(localStorage.getItem('jr_sac_db') || '{}');
d.usuarios = [];
localStorage.setItem('jr_sac_db', JSON.stringify(d));
localStorage.removeItem('jr_usuarios');
localStorage.removeItem('jr_sac_user');
location.reload();
```

No celular, sem console: **Configurações do navegador → limpar dados do site**.

**Como saber que o aparelho está na build nova:** abra o menu. Se estiver
**agrupado** (Visão Geral, Devoluções, CD, Operação & Frota, Pessoas,
Administração), atualizou. Se ainda for lista corrida de 14 itens, repita 4a.

---

## PASSO 5 — Confirmar que a base está limpa

Com todos os aparelhos já atualizados, espere ~40s e rode:

```sql
SELECT count(*) AS usuarios FROM usuarios;
```

**Esperado: 0.** Se voltou algum, um aparelho ainda estava com cache antigo —
repita o passo 4 nele e rode o Bloco 2 da limpeza de novo.

---

## PASSO 6 — Seu cadastro

Na tela de login → **Cadastre-se**. Nome, senha e **seu departamento real**
(ex.: `GERÊNCIA OPERACIONAL`).

Você entra com o papel do seu departamento — GESTOR, no exemplo. **Isso não
limita seu acesso à Administração:** aquelas quatro telas aparecem no menu
para qualquer usuário, com um cadeado 🔒 ao lado, e o que abre é a **senha de
administrador**. Um desbloqueio vale para as quatro e dura até você sair.

---

## PASSO 7 — Reset Global (zerar o operacional de teste)

Agora que você está logado: **Cadastros Mestres** → digitar a senha de admin →
**Reset Global de Treinamento** → confirmar digitando `RESETAR`.

Zera devoluções, viagens, ocorrências, reentregas, resumos, sinistros e a
trilha de auditoria. **Preserva** motoristas, veículos, produtos, clientes,
rotas, motivos, **departamentos** e **usuários** — o seu cadastro do passo 6
não se perde.

Faça isso **antes** de o time começar a cadastrar e usar. Todos os aparelhos
já estão na build nova desde o passo 4, que é a condição para o reset não ser
desfeito por um aparelho desatualizado.

**Confira:**

```sql
SELECT 'ocorrencias_devolucao' t, count(*) FROM ocorrencias_devolucao
UNION ALL SELECT 'controle_viagens', count(*) FROM controle_viagens
UNION ALL SELECT 'ocorrencias_rota', count(*) FROM ocorrencias_rota
UNION ALL SELECT 'reentregas_rota',  count(*) FROM reentregas_rota;
```

Esperado: **0 em todas**. E os cadastros mestres intactos:

```sql
SELECT 'motoristas' c, count(*) FROM motoristas
UNION ALL SELECT 'veiculos', count(*) FROM veiculos
UNION ALL SELECT 'usuarios', count(*) FROM usuarios          -- deve ser 1: você
UNION ALL SELECT 'departamentos', count(*) FROM departamentos; -- 19
```

---

## PASSO 8 — Cadastrar o time e revisar os papéis

Cada pessoa se cadastra na tela de login escolhendo o próprio departamento, ou
você cadastra por elas em "Logins e Senhas".

Depois, revise em **Logins e Senhas → Departamentos & Papéis de Acesso**:

- **`COMERCIAL` e `COMPRAS` estão como SAC** — é o papel que recebiam antes.
  Mantive assim para não conceder acesso novo sem decisão sua. Se não fizer
  sentido, troque no `select` da linha.
- O aviso amarelo lista quem ficou com departamento fora do cadastro. Essas
  pessoas veem **todas** as telas até serem corrigidas.

---

## Como a proteção funciona agora

Duas camadas, com papéis diferentes:

| Camada | O que faz | O que **não** faz |
|---|---|---|
| **Filtro do menu por papel** | Organiza — cada um vê o que usa | Não é segurança: "Ver todas as telas" desliga num clique |
| **Senha de administrador** | Protege Cadastros Mestres, Logins e Senhas, Governança & Lixeira e Conector Power BI | Não distingue pessoas: a senha é compartilhada |

O desbloqueio fica registrado na trilha de auditoria com o nome de quem estava
logado — como a senha é a mesma para todos, esse nome é a única autoria que
existe. Vale trocá-la se sair alguém da equipe.

---

## Se algo der errado

**Voltar o app** (não desfaz o SQL): republique a versão anterior pelo painel
da Vercel/Netlify — o histórico de deploys tem rollback.

**Publicar antes de rodar o SQL não quebra nada:** cada tabela sincroniza no
próprio `try/catch`. `departamentos` falharia sozinha, o resto continuaria
normal, e o cadastro ficaria só no aparelho até o SQL rodar.

**Testes** (rodam sem instalar nada, da raiz do projeto):

```bash
node tests/teste_cadastros.js && node tests/teste_sync.js && node tests/teste_boletim_e_tipoerro.js && node tests/teste_menu.js && node tests/teste_departamentos.js
```

Todos devem terminar com `0 falharam` — hoje são 236 no total.
