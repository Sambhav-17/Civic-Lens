/** Minimal IndexedDB key/value store for demo-mode media (data URLs). */
const DB = 'civiclens-demo-media';
const STORE = 'media';

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function tx<T>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await open();
  return new Promise((resolve, reject) => {
    const t = db.transaction(STORE, mode);
    const req = fn(t.objectStore(STORE));
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export const blobs = {
  put: (key: string, value: string) => tx('readwrite', (s) => s.put(value, key)),
  get: (key: string) => tx<string | undefined>('readonly', (s) => s.get(key)),
  clear: () => tx('readwrite', (s) => s.clear()),
};
