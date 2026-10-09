// Firebase's web configuration is public; authorization lives in database.rules.json.
import { initializeApp } from 'https://www.gstatic.com/firebasejs/13.0.0/firebase-app.js';
import { getAuth, onAuthStateChanged, signInWithEmailAndPassword, signOut, setPersistence, browserLocalPersistence } from 'https://www.gstatic.com/firebasejs/13.0.0/firebase-auth.js';
import { getDatabase, ref, get, onValue, runTransaction } from 'https://www.gstatic.com/firebasejs/13.0.0/firebase-database.js';

function decode(value) {
  if (!value || typeof value.payload !== 'string') throw new Error('В базе нет дневника. Обратись к владельцу сайта.');
  const payload = JSON.parse(value.payload);
  if (!Array.isArray(payload.types) || !Array.isArray(payload.workouts)) throw new Error('Некорректный формат дневника.');
  return { version: 1, revision: value.revision, ...payload };
}

export async function connect(config, handlers) {
  const app = initializeApp(config);
  const auth = getAuth(app);
  const db = getDatabase(app);
  let unsubscribe = null;
  let connected = false;
  onValue(ref(db, '.info/connected'), snapshot => {
    connected = snapshot.val() === true;
    handlers.onConnection(connected);
  });
  await setPersistence(auth, browserLocalPersistence);
  function stateRef() {
    if (!auth.currentUser) throw new Error('Войди в дневник ещё раз.');
    return ref(db, 'diaries/' + auth.currentUser.uid);
  }
  onAuthStateChanged(auth, user => {
    unsubscribe?.(); unsubscribe = null;
    handlers.onSession(user);
    if (user) unsubscribe = onValue(stateRef(), snapshot => {
      try { handlers.onData(decode(snapshot.val())); } catch { handlers.onError(); }
    }, handlers.onError);
  });
  return {
    signedIn: () => Boolean(auth.currentUser),
    async signIn(username, password) {
      if (username.trim().toLowerCase() !== 'dynochris') throw new Error('Неверный логин или пароль.');
      try { await signInWithEmailAndPassword(auth, 'dynochris@ritm.local', password); }
      catch (error) {
        throw new Error(error.code === 'auth/network-request-failed' ? 'Проверь подключение к интернету.' : error.code === 'auth/too-many-requests' ? 'Слишком много попыток. Попробуй позже.' : 'Неверный логин или пароль.');
      }
    },
    signOut: () => signOut(auth),
    async load() { return decode((await get(stateRef())).val()); },
    async save(next) {
      if (!connected || !navigator.onLine) throw new Error('Нет связи с хранилищем. Проверь интернет и повтори сохранение.');
      const target = stateRef();
      // Warm the local cache; the server retries this transaction against its latest value.
      await get(target);
      const result = await runTransaction(target, current => {
        if (!current || current.revision !== next.revision) return undefined;
        return { version: 1, revision: next.revision + 1, payload: JSON.stringify({ types: next.types, workouts: next.workouts }) };
      }, { applyLocally: false });
      if (!result.committed) return { status: 409, state: decode(result.snapshot.val()), error: 'Дневник изменился на другом устройстве.' };
      return { status: 200, state: decode(result.snapshot.val()) };
    }
  };
}
