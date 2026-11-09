// Связь с Firebase: анонимный вход, комнаты, присутствие, чтение/запись.
// Библиотеки Firebase грузятся только когда игрок выбирает «С друзьями»,
// поэтому игра с ботами работает без интернета.

const CFG = {
  apiKey: "AIzaSyCv3_KDU47yglDZ8fBlQ90R_3nQ0vIVSA4",
  authDomain: "valenok-fecd9.firebaseapp.com",
  databaseURL: "https://valenok-fecd9-default-rtdb.europe-west1.firebasedatabase.app",
  projectId: "valenok-fecd9",
  storageBucket: "valenok-fecd9.firebasestorage.app",
  messagingSenderId: "794214443147",
  appId: "1:794214443147:web:8916d57a123a924385cc8e"
};
const V = '10.12.2';
const BASE = `https://www.gstatic.com/firebasejs/${V}/`;

export const net = { uid: null, offset: 0, code: null };
let fb = null, unsubs = [], presenceUnsub = null;

export async function init() {
  if (fb) return fb;
  const [appM, authM, dbM] = await Promise.all([
    import(BASE + 'firebase-app.js'),
    import(BASE + 'firebase-auth.js'),
    import(BASE + 'firebase-database.js'),
  ]);
  const app = appM.initializeApp(CFG);
  const auth = authM.getAuth(app);
  const db = dbM.getDatabase(app);
  const user = await new Promise((res, rej) => {
    const off = authM.onAuthStateChanged(auth, u => {
      off();
      if (u) res(u); else authM.signInAnonymously(auth).then(c => res(c.user), rej);
    }, rej);
  });
  fb = { app, auth, db, D: dbM, uid: user.uid };
  net.uid = user.uid;
  dbM.onValue(dbM.ref(db, '.info/serverTimeOffset'), s => { net.offset = s.val() || 0; });
  return fb;
}

const R = p => fb.D.ref(fb.db, p);
export const now = () => Date.now() + net.offset;

function friendly(e) {
  const m = String(e && (e.code || e.message) || e);
  if (/admin-restricted|operation-not-allowed/.test(m)) return 'В Firebase не включён анонимный вход (Authentication → Anonymous).';
  if (/permission/i.test(m)) return 'Сервер отказал в доступе. Проверьте правила базы данных.';
  if (/network|Failed to fetch|import/i.test(m)) return 'Нет связи с сервером. Проверьте интернет.';
  return m;
}
export const errText = friendly;

async function presence(code) {
  const p = R(`rooms/${code}/presence/${fb.uid}`);
  if (presenceUnsub) presenceUnsub();
  presenceUnsub = fb.D.onValue(R('.info/connected'), async s => {
    if (!s.val()) return;
    await fb.D.onDisconnect(p).remove();
    await fb.D.set(p, true);
  });
}

export async function createRoom(name, timer) {
  await init();
  for (let i = 0; i < 25; i++) {
    const code = String(1000 + Math.floor(Math.random() * 9000));
    const res = await fb.D.runTransaction(R('rooms/' + code), cur => {
      if (cur) return; // занято — пробуем другой код
      return { host: fb.uid, created: Date.now(), status: 'lobby', timer,
               seats: [{ uid: fb.uid, name, kind: 'human' }] };
    });
    if (res.committed) { net.code = code; await presence(code); return code; }
  }
  throw new Error('Не удалось подобрать свободный код комнаты.');
}

// Вход по коду. Возвращает снимок комнаты.
export async function joinRoom(code, name) {
  await init();
  const snap = await fb.D.get(R('rooms/' + code));
  if (!snap.exists()) throw new Error('Комнаты с таким кодом нет.');
  const room = snap.val();
  const seats = room.seats || [];
  const mine = seats.findIndex(s => s && s.uid === fb.uid);
  if (room.status === 'closed') throw new Error('Эта комната уже закрыта.');
  if (room.host === fb.uid) throw new Error('Это ваша комната: вернитесь в неё кнопкой «Вернуться в комнату».');
  if (room.status !== 'lobby' && mine < 0) throw new Error('В этой комнате игра уже началась.');
  if (room.status === 'lobby' && mine < 0 && seats.length >= 4) throw new Error('Комната заполнена: в ней уже 4 игрока.');
  if (mine < 0) await fb.D.set(R(`rooms/${code}/joins/${fb.uid}`), { name, at: Date.now() });
  net.code = code;
  await presence(code);
  return room;
}

// Хозяин возвращается в свою комнату после перезапуска приложения
export async function hostRejoin(code) { await init(); net.code = code; await presence(code); }

export async function getRoom(code) { await init(); const s = await fb.D.get(R('rooms/' + code)); return s.val(); }

export function watch(path, cb) { const u = fb.D.onValue(R(path), s => cb(s.val())); unsubs.push(u); return u; }
export function watchAdded(path, cb) { const u = fb.D.onChildAdded(R(path), s => cb(s.key, s.val())); unsubs.push(u); return u; }
export const write = (path, v) => fb.D.set(R(path), v);
export const patchRoot = v => fb.D.update(fb.D.ref(fb.db), v);
export const del = path => fb.D.remove(R(path));
export const send = (code, a) => fb.D.push(R(`rooms/${code}/actions`), { ...a, uid: fb.uid, at: Date.now() });

export async function leave() {
  unsubs.forEach(u => u()); unsubs = [];
  if (presenceUnsub) { presenceUnsub(); presenceUnsub = null; }
  if (fb && net.code) {
    const p = R(`rooms/${net.code}/presence/${fb.uid}`);
    try { await fb.D.onDisconnect(p).cancel(); await fb.D.remove(p); } catch (e) {}
  }
  net.code = null;
}
