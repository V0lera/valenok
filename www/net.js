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
  fb = { app, auth, db, D: dbM, A: authM, uid: user.uid };
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

export async function createRoom(name, timer, ava) {
  await init();
  for (let i = 0; i < 25; i++) {
    const code = String(1000 + Math.floor(Math.random() * 9000));
    const res = await fb.D.runTransaction(R('rooms/' + code), cur => {
      if (cur) return; // занято — пробуем другой код
      return { host: fb.uid, created: Date.now(), status: 'lobby', timer,
               seats: [{ uid: fb.uid, name, ava: ava || null, kind: 'human' }] };
    });
    if (res.committed) { net.code = code; await presence(code); return code; }
  }
  throw new Error('Не удалось подобрать свободный код комнаты.');
}

// Вход по коду. Возвращает снимок комнаты.
export async function joinRoom(code, name, ava) {
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
  if (mine < 0) await fb.D.set(R(`rooms/${code}/joins/${fb.uid}`), { name, ava: ava || null, at: Date.now() });
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

/* ================= Профиль и статистика ================= */
// Сложить накопленные на телефоне приращения со статистикой в облаке
export async function addStats(pending, name) {
  await init();
  for (const mode of Object.keys(pending)) {
    const add = pending[mode] || {};
    await fb.D.runTransaction(R(`users/${fb.uid}/stats/${mode}`), cur => {
      const s = cur || {};
      for (const [k, v] of Object.entries(add)) {
        if (k === 'bestMinus') s[k] = Math.min(s[k] ?? 0, v);
        else if (MAXK.has(k)) s[k] = Math.max(s[k] || 0, v);
        else s[k] = (s[k] || 0) + v;
      }
      return s;
    });
  }
  if (name) await fb.D.set(R(`users/${fb.uid}/name`), name);
}
const MAXK = new Set(['maxHand', 'bestStreak']);
// Личные встречи с друзьями: users/<я>/rivals/<друг>
export async function addRivals(rivals) {
  await init();
  for (const [rid, r] of Object.entries(rivals || {})) {
    await fb.D.runTransaction(R(`users/${fb.uid}/rivals/${rid}`), cur => {
      const s = cur || {};
      s.name = r.name || s.name || 'Игрок';
      if (r.ava) s.ava = r.ava;
      for (const k of ['games', 'w', 'l']) s[k] = (s[k] || 0) + (r[k] || 0);
      s.last = Date.now();
      return s;
    });
  }
}
export async function setAch(ids) {
  await init();
  const u = {}; for (const id of ids) u[`users/${fb.uid}/ach/${id}`] = Date.now();
  if (ids.length) await fb.D.update(fb.D.ref(fb.db), u);
}
export async function setAvatar(ava) { await init(); await fb.D.set(R(`users/${fb.uid}/avatar`), ava); }
export async function getProfile() {
  await init();
  const s = await fb.D.get(R(`users/${fb.uid}`));
  const v = s.val() || {};
  return { stats: v.stats || {}, rivals: v.rivals || {}, ach: v.ach || {}, avatar: v.avatar || null };
}
export async function getStats() {
  await init();
  const s = await fb.D.get(R(`users/${fb.uid}/stats`));
  return s.val() || {};
}
export function email() { return fb && fb.auth.currentUser && fb.auth.currentUser.email || null; }

function authText(e) {
  const c = String(e && e.code || '');
  const m = {
    'auth/email-already-in-use': 'Эта почта уже привязана к другому профилю. Нажмите «Войти».',
    'auth/credential-already-in-use': 'Эта почта уже привязана к другому профилю. Нажмите «Войти».',
    'auth/invalid-email': 'Почта написана с ошибкой.',
    'auth/weak-password': 'Пароль слишком короткий: нужно хотя бы 6 символов.',
    'auth/missing-password': 'Введите пароль.',
    'auth/wrong-password': 'Неверная почта или пароль.',
    'auth/invalid-credential': 'Неверная почта или пароль.',
    'auth/user-not-found': 'Профиля с такой почтой нет. Нажмите «Привязать».',
    'auth/too-many-requests': 'Слишком много попыток. Подождите пару минут.',
    'auth/operation-not-allowed': 'В Firebase не включён вход по почте (Authentication → Email/Password).',
    'auth/network-request-failed': 'Нет связи с сервером. Проверьте интернет.',
  };
  return m[c] || friendly(e);
}
export const authErrText = authText;

// Привязать почту к текущему (анонимному) профилю — статистика остаётся
export async function linkEmail(mail, pw) {
  await init();
  const cred = fb.A.EmailAuthProvider.credential(mail, pw);
  await fb.A.linkWithCredential(fb.auth.currentUser, cred);
}
// Войти в уже существующий профиль (например, на новом телефоне)
export async function signInEmail(mail, pw) {
  await init();
  const c = await fb.A.signInWithEmailAndPassword(fb.auth, mail, pw);
  fb.uid = net.uid = c.user.uid;
}
// Выйти из профиля: телефон получает новый анонимный профиль
export async function signOutToAnon() {
  await init();
  await fb.A.signOut(fb.auth);
  const c = await fb.A.signInAnonymously(fb.auth);
  fb.uid = net.uid = c.user.uid;
}

export async function leave() {
  unsubs.forEach(u => u()); unsubs = [];
  if (presenceUnsub) { presenceUnsub(); presenceUnsub = null; }
  if (fb && net.code) {
    const p = R(`rooms/${net.code}/presence/${fb.uid}`);
    try { await fb.D.onDisconnect(p).cancel(); await fb.D.remove(p); } catch (e) {}
  }
  net.code = null;
}
