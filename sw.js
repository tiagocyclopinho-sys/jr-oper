// =================================================================
// SERVICE WORKER - JR OPER v4.7
// Habilita instalação em qualquer aparelho (Android, iPhone, PC, Mac)
// Cache offline para funcionar sem internet
// =================================================================

const CACHE_NAME = 'jr-oper-v4.8.5';

// Arquivos que serão salvos para funcionar offline
const FILES_TO_CACHE = [
  './',
  './index.html',
  './manifest.json',
  './js/config.js',
  './js/cloudStore.js',
  './js/store.js',
  './js/app.js',
  './js/tailwind.cdn.js',
  './js/xlsx.full.min.js',
  './public/icon-512.png',
  './public/logo.png',
  './public/logo_jr_branca.png'
];

// INSTALAÇÃO: salva os arquivos no cache do aparelho
self.addEventListener('install', (event) => {
  console.log('[SW] Instalando JR Oper...');
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(FILES_TO_CACHE).catch((err) => {
        // Se algum arquivo falhar, continua mesmo assim
        console.warn('[SW] Alguns arquivos não foram cacheados:', err);
      });
    }).then(() => {
      console.log('[SW] JR Oper instalado com sucesso!');
      return self.skipWaiting();
    })
  );
});

// ATIVAÇÃO: remove versões antigas do cache
self.addEventListener('activate', (event) => {
  console.log('[SW] Ativando nova versão do JR Oper...');
  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames
          .filter((name) => name !== CACHE_NAME)
          .map((name) => {
            console.log('[SW] Removendo cache antigo:', name);
            return caches.delete(name);
          })
      );
    }).then(() => self.clients.claim())
  );
});

// Corta a espera pela rede depois de N segundos e cai pro cache — sem
// isso, um 5G com sinal fraco em rota (alta latência, não uma falha de
// verdade) deixava a tela em branco até o timeout default do navegador,
// que pode passar de 30s (achado em 20/08/2026, auditoria externa).
const FETCH_TIMEOUT_MS = 6000;
function fetchComTimeout(request) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('timeout')), FETCH_TIMEOUT_MS);
    fetch(request).then(
      (response) => { clearTimeout(timer); resolve(response); },
      (err) => { clearTimeout(timer); reject(err); }
    );
  });
}

// ESTRATÉGIA: Tenta buscar da internet primeiro, se falhar usa o cache (offline)
self.addEventListener('fetch', (event) => {
  // Ignora requisições que não são GET (ex: POST para o Supabase)
  if (event.request.method !== 'GET') return;

  // Ignora requisições para o Supabase (banco de dados online - não cacheável)
  if (event.request.url.includes('supabase.co')) return;

  event.respondWith(
    fetchComTimeout(event.request)
      .then((response) => {
        // Se deu certo online, salva uma cópia no cache e retorna
        if (response && response.status === 200) {
          const responseClone = response.clone();
          caches.open(CACHE_NAME).then((cache) => {
            cache.put(event.request, responseClone);
          });
        }
        return response;
      })
      .catch(() => {
        // Se falhou (sem internet), usa o cache salvo
        return caches.match(event.request).then((cached) => {
          if (cached) {
            console.log('[SW] Servindo do cache offline:', event.request.url);
            return cached;
          }
          // Se não tem no cache, retorna a página principal
          return caches.match('./index.html');
        });
      })
  );
});

// Recebe mensagem para forçar atualização
self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});
