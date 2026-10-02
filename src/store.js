/* 本地持久化：自动草稿 + 多方案槽位。

   为什么分成两块存储：
     · 参数（P 的快照）很小、读写频繁 → localStorage，同步读写，刷新即可恢复；
     · 贴图是 base64 dataURL，动辄几 MB → IndexedDB（localStorage 的 5MB 配额装不下两张）。
   贴图单独存还有个好处：草稿恢复时 blob 不用再解码一次，直接喂给 makeTex。

   ⚠️ 全部走 try/catch：隐私模式 / 禁用存储 / 配额满都会抛，
   存储失败**绝不能**影响调参本身 —— 存不下只是"少了一个后悔药"。 */

const LS_DRAFT = '3dm.draft.v1';
const LS_SLOTS = '3dm.slots.v1';
const DB_NAME = '3dm-store';
const DB_STORE = 'textures';
const DB_VERSION = 1;

// 不参与持久化的参数：贴图是 Blob（走 IndexedDB），classicCtrl 随 P 一起存。
// 这里只列"存了反而有害"的项 —— 目前没有，留空以便将来登记。
const SKIP_KEYS = [];

export function snapshotParams(P) {
  const out = {};
  for (const [k, v] of Object.entries(P)) {
    if (SKIP_KEYS.includes(k)) continue;
    out[k] = (v && typeof v === 'object') ? structuredClone(v) : v;
  }
  return out;
}

/* ---------- localStorage：草稿与槽位索引 ---------- */
const ls = () => {
  try { return window.localStorage; } catch (e) { return null; }
};

export function saveDraft(snap) {
  const s = ls();
  if (!s) return false;
  try { s.setItem(LS_DRAFT, JSON.stringify(snap)); return true; }
  catch (e) { return false; }   // 配额满 / 隐私模式：静默降级，不打扰用户
}
export function loadDraft() {
  const s = ls();
  if (!s) return null;
  try {
    const raw = s.getItem(LS_DRAFT);
    return raw ? JSON.parse(raw) : null;
  } catch (e) { return null; }
}
export function clearDraft() {
  const s = ls();
  if (!s) return;
  try { s.removeItem(LS_DRAFT); } catch (e) { /* 同上 */ }
}

// 槽位索引只存元数据（id / 名称 / 时间 / 有无贴图），参数与贴图本体另存。
export function listSlots() {
  const s = ls();
  if (!s) return [];
  try { return JSON.parse(s.getItem(LS_SLOTS) || '[]'); }
  catch (e) { return []; }
}
function writeSlots(list) {
  const s = ls();
  if (!s) return false;
  try { s.setItem(LS_SLOTS, JSON.stringify(list)); return true; }
  catch (e) { return false; }
}
export async function saveSlot(name, snap, tex) {
  const list = listSlots();
  const id = 's' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  const meta = { id, name: name || '未命名', at: Date.now(), tex: !!tex };
  const next = list.filter(x => x.id !== id).concat([meta]).slice(-24);
  if (!writeSlots(next)) throw new Error('存储不可用');
  await idbPut(id, { params: snap, tex: tex || null });
  return { meta, slots: next };
}
export async function loadSlot(id) {
  const rec = await idbGet(id);
  if (!rec) throw new Error('方案不存在或已被清理');
  return rec;
}
export async function deleteSlot(id) {
  const next = listSlots().filter(x => x.id !== id);
  writeSlots(next);
  await idbDel(id);
  return next;
}

/* ---------- IndexedDB：贴图 / 方案本体 ---------- */
let dbPromise = null;
function openDB() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') { reject(new Error('浏览器不支持 IndexedDB')); return; }
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(DB_STORE)) db.createObjectStore(DB_STORE);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error || new Error('无法打开本地存储'));
  }).catch(err => { dbPromise = null; throw err; });
  return dbPromise;
}
async function idbPut(key, val) {
  const db = await openDB();
  return new Promise((res, rej) => {
    const tx = db.transaction(DB_STORE, 'readwrite');
    tx.objectStore(DB_STORE).put(val, key);
    tx.oncomplete = () => res(true);
    tx.onerror = () => rej(tx.error);
  });
}
async function idbGet(key) {
  const db = await openDB();
  return new Promise((res, rej) => {
    const tx = db.transaction(DB_STORE, 'readonly');
    const r = tx.objectStore(DB_STORE).get(key);
    r.onsuccess = () => res(r.result || null);
    r.onerror = () => rej(r.error);
  });
}
async function idbDel(key) {
  const db = await openDB();
  return new Promise((res, rej) => {
    const tx = db.transaction(DB_STORE, 'readwrite');
    tx.objectStore(DB_STORE).delete(key);
    tx.oncomplete = () => res(true);
    tx.onerror = () => rej(tx.error);
  });
}

// 冒烟测试 / 调试用：把某次写入的状态读回来，不依赖 UI
export const __storeKeys = { LS_DRAFT, LS_SLOTS, DB_NAME };
