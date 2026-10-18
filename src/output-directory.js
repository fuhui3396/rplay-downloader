// Persists a user-picked output directory (File System Access API handle).
// The handle is stored in IndexedDB because it is not JSON-serializable and so
// it is never written to chrome.storage.

const DB_NAME = 'rplay-output';
const STORE_NAME = 'handles';
const HANDLE_KEY = 'output';

function openDatabase() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => request.result.createObjectStore(STORE_NAME);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function transaction(db, mode, action) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, mode);
    const request = action(tx.objectStore(STORE_NAME));
    tx.oncomplete = () => resolve(request?.result ?? null);
    tx.onerror = tx.onabort = () => reject(tx.error);
  });
}

export async function saveDirectoryHandle(handle) {
  const db = await openDatabase();
  try {
    await transaction(db, 'readwrite', (store) => store.put(handle, HANDLE_KEY));
  } finally {
    db.close();
  }
}

export async function loadDirectoryHandle() {
  if (typeof indexedDB === 'undefined') return null;
  let db;
  try {
    db = await openDatabase();
    return await transaction(db, 'readonly', (store) => store.get(HANDLE_KEY));
  } catch {
    return null;
  } finally {
    db?.close();
  }
}

export async function clearDirectoryHandle() {
  const db = await openDatabase();
  try {
    await transaction(db, 'readwrite', (store) => store.delete(HANDLE_KEY));
  } finally {
    db.close();
  }
}

export async function directoryPermission(handle, { request = false } = {}) {
  if (!handle?.queryPermission) return 'unsupported';
  const query = { mode: 'readwrite' };
  let state = await handle.queryPermission(query);
  if (state !== 'granted' && request && handle.requestPermission) {
    state = await handle.requestPermission(query);
  }
  return state;
}

// Only the offscreen document uses this: it cannot prompt for permission, so
// it writes only when the options page already granted access.
export async function resolveWritableDirectory() {
  const handle = await loadDirectoryHandle();
  if (!handle) return null;
  return await directoryPermission(handle) === 'granted' ? handle : null;
}

export async function writeFileToDirectory(root, relativePath, blob) {
  const segments = String(relativePath || '').split('/').filter(Boolean);
  const filename = segments.pop();
  if (!filename) throw new Error('输出路径为空');
  let directory = root;
  for (const segment of segments) {
    directory = await directory.getDirectoryHandle(segment, { create: true });
  }
  const fileHandle = await directory.getFileHandle(filename, { create: true });
  const writable = await fileHandle.createWritable();
  try {
    await writable.write(blob);
  } finally {
    await writable.close();
  }
}