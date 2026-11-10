// Кэш оболочки приложения: игра с ботами работает без интернета.
const CACHE='valenok-v8';
const FILES=['./','index.html','style.css','fonts.css','app.js','net.js','manifest.webmanifest',
  'icons/icon-192.png','icons/icon-512.png',
  'fonts/GolosText-cyrillic-0.woff2','fonts/GolosText-latin-1.woff2','fonts/RuslanDisplay-cyrillic-2.woff2','fonts/RuslanDisplay-latin-3.woff2'];
self.addEventListener('install',e=>{e.waitUntil(caches.open(CACHE).then(c=>c.addAll(FILES)).then(()=>self.skipWaiting()));});
self.addEventListener('activate',e=>{e.waitUntil(caches.keys().then(ks=>Promise.all(ks.filter(k=>k!==CACHE).map(k=>caches.delete(k)))).then(()=>self.clients.claim()));});
self.addEventListener('fetch',e=>{
  const u=new URL(e.request.url);
  if(e.request.method!=='GET'||u.origin!==location.origin)return; // Firebase и прочее — напрямую
  // сначала сеть (чтобы обновления приходили сразу), без сети — из кэша
  e.respondWith(fetch(e.request).then(r=>{const c=r.clone();caches.open(CACHE).then(x=>x.put(e.request,c));return r;}).catch(()=>caches.match(e.request,{ignoreSearch:true})));
});
