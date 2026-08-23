// Harness de teste da sincronização — roda cloudStore.js fora do navegador
// contra um PostgREST simulado (com limite de 1.000 linhas por leitura,
// como o Supabase).
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const RAIZ = path.join(__dirname, '..');

function novoLocalStorage(inicial = {}) {
  const mapa = new Map(Object.entries(inicial));
  return {
    getItem: k => (mapa.has(k) ? mapa.get(k) : null),
    setItem: (k, v) => mapa.set(k, String(v)),
    removeItem: k => mapa.delete(k),
    get length() { return mapa.size; },
    key: i => [...mapa.keys()][i],
    _mapa: mapa
  };
}
// Object.keys(localStorage) é usado no código real; com um objeto comum
// as chaves são as próprias propriedades, então espelhamos num Proxy.
function comKeys(ls) {
  return new Proxy(ls, {
    ownKeys: t => [...t._mapa.keys(), ...Reflect.ownKeys(t)],
    getOwnPropertyDescriptor: (t, p) =>
      t._mapa.has(p)
        ? { value: t._mapa.get(p), enumerable: true, configurable: true }
        : Reflect.getOwnPropertyDescriptor(t, p)
  });
}

// ---- PostgREST simulado -------------------------------------------------
function novoServidor(tabelasIniciais = {}) {
  const tabelas = {};
  Object.keys(tabelasIniciais).forEach(t => (tabelas[t] = tabelasIniciais[t].slice()));
  const registro = { posts: [], gets: [], loteMaximo: 0, recusar: null };
  const LIMITE_LEITURA = 1000; // igual ao padrão do Supabase

  async function fetchFalso(url, opcoes = {}) {
    const u = new URL(url);
    const tabela = u.pathname.replace('/rest/v1/', '').split('?')[0];
    const metodo = opcoes.method || 'GET';

    if (metodo === 'GET') {
      registro.gets.push(tabela);
      if (tabela === 'sync_control') {
        return resposta(200, JSON.stringify([{ id: 1, reset_epoch: 0 }]));
      }
      const linhas = tabelas[tabela] || [];
      const range = (opcoes.headers && opcoes.headers['Range']) || null;
      let inicio = 0, fim = LIMITE_LEITURA - 1;
      if (range) {
        const [a, b] = range.split('-').map(Number);
        inicio = a; fim = Math.min(b, a + LIMITE_LEITURA - 1);
      }
      const fatia = linhas.slice(inicio, fim + 1);
      return resposta(fatia.length < (fim - inicio + 1) ? 200 : 206, JSON.stringify(fatia));
    }

    if (metodo === 'POST') {
      const corpo = JSON.parse(opcoes.body);
      registro.posts.push({ tabela, quantidade: corpo.length, corpo });
      registro.loteMaximo = Math.max(registro.loteMaximo, corpo.length);
      if (registro.recusar && registro.recusar(tabela, registro.posts.length)) {
        return resposta(400, JSON.stringify({ message: 'recusa simulada' }));
      }
      if (!tabelas[tabela]) tabelas[tabela] = [];
      const chave = ('nome' in (corpo[0] || {})) ? 'nome' : 'id';
      corpo.forEach(r => {
        const i = tabelas[tabela].findIndex(x => x[chave] === r[chave]);
        if (i >= 0) tabelas[tabela][i] = r; else tabelas[tabela].push(r);
      });
      return resposta(201, '');
    }
    return resposta(200, '[]');
  }

  function resposta(status, texto) {
    return {
      ok: status >= 200 && status < 300,
      status,
      text: async () => texto,
      json: async () => JSON.parse(texto || '[]')
    };
  }

  return { fetch: fetchFalso, tabelas, registro };
}

function carregarCloudStore(ls, servidor) {
  const codigo = fs.readFileSync(path.join(RAIZ, 'js/cloudStore.js'), 'utf8');
  const ouvintes = {};
  const janela = {
    JR_CONFIG: { supabase: { url: 'https://x.supabase.co', anonKey: 'chave-anon-de-teste-com-mais-de-20-caracteres', syncIntervalMs: 30000 }, mode: 'cloud' },
    alert: () => {},
    addEventListener: (e, f) => (ouvintes[e] = f),
    dispatchEvent: () => {},
    db: null
  };
  const sandbox = {
    window: janela,
    localStorage: comKeys(ls),
    console: { log: () => {}, warn: () => {}, error: () => {}, table: () => {} },
    fetch: servidor.fetch,
    setTimeout, clearTimeout,
    document: { addEventListener: () => {}, getElementById: () => null },
    CustomEvent: function () {},
    URL
  };
  sandbox.window.window = sandbox.window;
  vm.createContext(sandbox);
  vm.runInContext(codigo, sandbox, { filename: 'cloudStore.js' });
  return sandbox.window.cloudStore;
}

let falhas = 0, passes = 0;
function ok(cond, titulo, detalhe) {
  if (cond) { passes++; console.log('  PASS  ' + titulo); }
  else { falhas++; console.log('  FALHA ' + titulo + (detalhe ? '\n        -> ' + detalhe : '')); }
}
function secao(t) { console.log('\n=== ' + t + ' ==='); }

const muitosClientes = Array.from({ length: 1500 }, (_, i) => ({
  id: i + 1, codigo: String(i + 1), codigo_cliente: String(i + 1),
  nome: 'CLIENTE ' + i, razao_social: 'CLIENTE ' + i, cidade: 'Araguaína', uf: 'TO'
}));

function estadoLocalPadrao() {
  return {
    jr_sac_db: JSON.stringify({
      motoristas: [{ id: 1, nome: 'JOAO' }],
      rotas: ['ROTA A', 'ROTA B'],
      rotas_inativos: ['ROTA VELHA'],
      motivos_devolucao: ['AVARIA', 'NOTA DENEGADA'],
      motivos_devolucao_inativos: ['MOTIVO REMOVIDO']
    }),
    jr_sac_static: JSON.stringify({ clientes: muitosClientes, produtos: [{ id: 567, codigo_produto: '567', descricao: 'ASA', categoria: 'Frios', valor_unitario_padrao: 0 }] })
  };
}

// ---------------------------------------------------------------
(async () => {
  secao('1. Push — as 4 coleções que nunca chegavam ao banco');
  {
    const ls = novoLocalStorage(estadoLocalPadrao());
    const srv = novoServidor();
    const cs = carregarCloudStore(ls, srv);
    await cs.syncLocalToCloud();

    ok(!!srv.tabelas['motivos_devolucao'], 'tabela motivos_devolucao recebeu envio');
    ok(!!srv.tabelas['rotas'], 'tabela rotas recebeu envio');
    ok(!!srv.tabelas['clientes'], 'tabela clientes recebeu envio');
    ok(!!srv.tabelas['produtos'], 'tabela produtos recebeu envio');

    const mot = srv.tabelas['motivos_devolucao'] || [];
    const denegada = mot.find(m => m.nome === 'NOTA DENEGADA');
    ok(denegada && denegada.ativo === true, 'motivo ativo sobe com ativo=true', JSON.stringify(denegada));
    const removido = mot.find(m => m.nome === 'MOTIVO REMOVIDO');
    ok(removido && removido.ativo === false, 'motivo excluído sobe como ativo=false (exclusão propaga)');
    ok(mot.every(m => typeof m.nome === 'string' && m.nome !== '[object Object]'),
       'nenhuma linha virou "[object Object]"');

    const rotas = srv.tabelas['rotas'] || [];
    ok(rotas.find(r => r.nome === 'ROTA VELHA')?.ativo === false, 'rota excluída sobe como ativo=false');

    const cli = srv.tabelas['clientes'][0];
    ok(!('codigo' in cli) && !('nome' in cli),
       'campos que só existem no app (codigo/nome) foram removidos antes do envio', JSON.stringify(cli));
    ok('codigo_cliente' in cli && 'razao_social' in cli, 'colunas reais preservadas');
  }

  secao('2. Push — lotes de 500 (evita corpo de MB e falha tudo-ou-nada)');
  {
    const ls = novoLocalStorage(estadoLocalPadrao());
    const srv = novoServidor();
    const cs = carregarCloudStore(ls, srv);
    await cs.syncLocalToCloud();

    ok(srv.registro.loteMaximo <= 500, `nenhum POST passou de 500 linhas (maior: ${srv.registro.loteMaximo})`);
    const postsClientes = srv.registro.posts.filter(p => p.tabela === 'clientes');
    ok(postsClientes.length === 3, `1.500 clientes viraram 3 lotes (foram ${postsClientes.length})`);
    ok(srv.tabelas['clientes'].length === 1500, 'as 1.500 linhas chegaram ao banco');
  }

  secao('3. Push — não reenvia o que não mudou');
  {
    const ls = novoLocalStorage(estadoLocalPadrao());
    const srv = novoServidor();
    const cs = carregarCloudStore(ls, srv);
    await cs.syncLocalToCloud();
    const posts1 = srv.registro.posts.length;
    await cs.syncLocalToCloud();
    const posts2 = srv.registro.posts.length;
    ok(posts2 === posts1, `2º ciclo sem alterações não gastou requisição (${posts1} -> ${posts2})`);

    // agora muda uma coisa só
    const db = JSON.parse(ls.getItem('jr_sac_db'));
    db.motivos_devolucao.push('MOTIVO NOVO');
    ls.setItem('jr_sac_db', JSON.stringify(db));
    await cs.syncLocalToCloud();
    const novos = srv.registro.posts.slice(posts2);
    ok(novos.length === 1 && novos[0].tabela === 'motivos_devolucao',
       'só a tabela alterada foi reenviada', JSON.stringify(novos.map(n => n.tabela)));
  }

  secao('4. Pull — linhas do banco viram as listas do app');
  {
    const srv = novoServidor({
      motivos_devolucao: [
        { nome: 'AVARIA', ativo: true },
        { nome: 'NOTA DENEGADA', ativo: true },
        { nome: 'MOTIVO REMOVIDO', ativo: false }
      ],
      rotas: [{ nome: 'ROTA A', ativo: true }]
    });
    const ls = novoLocalStorage(estadoLocalPadrao());
    const cs = carregarCloudStore(ls, srv);
    await cs.syncCloudToLocal();

    const db = JSON.parse(ls.getItem('jr_sac_db'));
    ok(Array.isArray(db.motivos_devolucao) && typeof db.motivos_devolucao[0] === 'string',
       'motivos voltaram como array de TEXTO (formato que as telas consomem)', JSON.stringify(db.motivos_devolucao));
    ok(db.motivos_devolucao.includes('NOTA DENEGADA'), 'motivo criado em outro aparelho chegou aqui');
    ok(!db.motivos_devolucao.includes('MOTIVO REMOVIDO'), 'motivo excluído em outro aparelho saiu da lista');
    ok(db.motivos_devolucao_inativos.includes('MOTIVO REMOVIDO'),
       'exclusão virou lápide local (não volta como ativo no próximo push)');
  }

  secao('5. Pull — catálogo pesado não polui a fatia operacional');
  {
    const srv = novoServidor({ clientes: muitosClientes.map(c => ({ ...c, codigo: undefined, nome: undefined })) });
    const ls = novoLocalStorage(estadoLocalPadrao());
    const cs = carregarCloudStore(ls, srv);
    await cs.syncCloudToLocal();

    const db = JSON.parse(ls.getItem('jr_sac_db'));
    ok(!('clientes' in db) && !('produtos' in db),
       'clientes/produtos NÃO entraram em jr_sac_db (a divisão de chaves foi preservada)');
    const est = JSON.parse(ls.getItem('jr_sac_static'));
    ok(Array.isArray(est.clientes), 'clientes foram gravados em jr_sac_static');
  }

  secao('6. Pull — leitura paginada (limite de 1.000 linhas do PostgREST)');
  {
    const srv = novoServidor({ clientes: muitosClientes });
    const ls = novoLocalStorage({
      jr_sac_db: JSON.stringify({ motoristas: [] }),
      jr_sac_static: JSON.stringify({ clientes: [], produtos: [] }),
      jr_sync_ok_clientes: '1'
    });
    const cs = carregarCloudStore(ls, srv);
    await cs.syncCloudToLocal();
    const est = JSON.parse(ls.getItem('jr_sac_static'));
    ok(est.clientes.length === 1500,
       `as 1.500 linhas foram lidas, não só as 1.000 da 1ª página (vieram ${est.clientes.length})`);
  }

  secao('7. Pull — nuvem menor que o aparelho não apaga o catálogo');
  {
    // cenário real: o push de clientes falhou no meio, a nuvem ficou com 500
    // das 1.500 linhas e a tabela nunca subiu inteira.
    const srv = novoServidor({ clientes: muitosClientes.slice(0, 500) });
    const ls = novoLocalStorage(estadoLocalPadrao()); // 1.500 locais, sem jr_sync_ok_clientes
    const cs = carregarCloudStore(ls, srv);
    await cs.syncCloudToLocal();

    const est = JSON.parse(ls.getItem('jr_sac_static'));
    ok(est.clientes.length === 1500,
       `catálogo local preservado (${est.clientes.length} linhas) em vez de reduzido a 500`);
    ok(cs.getDiagnostico().tabelasComPendencia.includes('clientes'),
       'a tabela ficou marcada como pendente de envio, visível no diagnóstico');
  }

  secao('8. Ida e volta completa entre dois aparelhos');
  {
    const srv = novoServidor();
    // Aparelho A cadastra NOTA DENEGADA e envia
    const lsA = novoLocalStorage({
      jr_sac_db: JSON.stringify({ motivos_devolucao: ['AVARIA', 'NOTA DENEGADA'], motivos_devolucao_inativos: [] }),
      jr_sac_static: JSON.stringify({ clientes: [], produtos: [] })
    });
    const csA = carregarCloudStore(lsA, srv);
    await csA.syncLocalToCloud();

    // Aparelho B nunca viu esse motivo
    const lsB = novoLocalStorage({
      jr_sac_db: JSON.stringify({ motivos_devolucao: ['AVARIA'], motivos_devolucao_inativos: [] }),
      jr_sac_static: JSON.stringify({ clientes: [], produtos: [] })
    });
    const csB = carregarCloudStore(lsB, srv);
    await csB.syncCloudToLocal();

    const dbB = JSON.parse(lsB.getItem('jr_sac_db'));
    ok(dbB.motivos_devolucao.includes('NOTA DENEGADA'),
       'motivo cadastrado no aparelho A apareceu no aparelho B — sem SQL manual');

    // B exclui; A recebe a exclusão
    const dbB2 = JSON.parse(lsB.getItem('jr_sac_db'));
    dbB2.motivos_devolucao = dbB2.motivos_devolucao.filter(m => m !== 'NOTA DENEGADA');
    dbB2.motivos_devolucao_inativos = ['NOTA DENEGADA'];
    lsB.setItem('jr_sac_db', JSON.stringify(dbB2));
    await csB.syncLocalToCloud();
    await csA.syncCloudToLocal();

    const dbA = JSON.parse(lsA.getItem('jr_sac_db'));
    ok(!dbA.motivos_devolucao.includes('NOTA DENEGADA'),
       'exclusão feita no aparelho B chegou ao aparelho A (não "voltou sozinho")');
  }

  console.log('\n=======================================');
  console.log(`  ${passes} passaram, ${falhas} falharam`);
  console.log('=======================================');
  process.exit(falhas ? 1 : 0);
})();
