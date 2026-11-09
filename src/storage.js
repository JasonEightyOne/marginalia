// Local-first storage. PDFs (as Blobs), document metadata and annotations live in
// IndexedDB in the reader's own browser. If IndexedDB is unavailable (some private
// windows), an in-memory store keeps the app usable for the session.

const DB_NAME = 'marginalia';
const DB_VERSION = 1;

const plain = (o) => JSON.parse(JSON.stringify(o));
const wrap = (r) =>
  new Promise((res, rej) => {
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  });
const done = (tx) =>
  new Promise((res, rej) => {
    tx.oncomplete = () => res();
    tx.onerror = () => rej(tx.error);
    tx.onabort = () => rej(tx.error || new Error('Transaction aborted'));
  });

function openDb() {
  return new Promise((res, rej) => {
    const r = indexedDB.open(DB_NAME, DB_VERSION);
    r.onupgradeneeded = () => {
      const d = r.result;
      if (!d.objectStoreNames.contains('files')) d.createObjectStore('files');
      if (!d.objectStoreNames.contains('docs')) d.createObjectStore('docs', { keyPath: 'id' });
      if (!d.objectStoreNames.contains('annots')) {
        const a = d.createObjectStore('annots', { keyPath: 'id' });
        a.createIndex('docId', 'docId');
      }
      if (!d.objectStoreNames.contains('kv')) d.createObjectStore('kv');
    };
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
    r.onblocked = () => rej(new Error('Database blocked by another tab'));
  });
}

function idbBackend(db) {
  const os = (name, mode = 'readonly') => db.transaction(name, mode).objectStore(name);
  return {
    kind: 'browser',
    allDocs: () => wrap(os('docs').getAll()),
    putDoc: (d) => wrap(os('docs', 'readwrite').put(plain(d))),
    async putFile(id, blob) {
      await wrap(os('files', 'readwrite').put(blob, id));
    },
    async getFile(id) {
      const b = await wrap(os('files').get(id));
      if (!b) return null;
      return new Uint8Array(await b.arrayBuffer());
    },
    getFileBlob: (id) => wrap(os('files').get(id)),
    annots: (docId) => wrap(os('annots').index('docId').getAll(docId)),
    allAnnots: () => wrap(os('annots').getAll()),
    putAnnot: (a) => wrap(os('annots', 'readwrite').put(plain(a))),
    deleteAnnot: (id) => wrap(os('annots', 'readwrite').delete(id)),
    async deleteDoc(doc) {
      const tx = db.transaction(['docs', 'files', 'annots'], 'readwrite');
      tx.objectStore('docs').delete(doc.id);
      tx.objectStore('files').delete(doc.fileId);
      const idx = tx.objectStore('annots').index('docId');
      const keys = await wrap(idx.getAllKeys(doc.id));
      keys.forEach((k) => tx.objectStore('annots').delete(k));
      await done(tx);
    },
    kvGet: (k) => wrap(os('kv').get(k)),
    kvSet: (k, v) => wrap(os('kv', 'readwrite').put(v, k)),
  };
}

function memoryBackend() {
  const docs = new Map(), files = new Map(), annots = new Map(), kv = new Map();
  return {
    kind: 'memory',
    allDocs: async () => [...docs.values()].map(plain),
    putDoc: async (d) => void docs.set(d.id, plain(d)),
    putFile: async (id, blob) => void files.set(id, blob),
    async getFile(id) {
      const b = files.get(id);
      return b ? new Uint8Array(await b.arrayBuffer()) : null;
    },
    getFileBlob: async (id) => files.get(id),
    annots: async (docId) => [...annots.values()].filter((a) => a.docId === docId).map(plain),
    allAnnots: async () => [...annots.values()].map(plain),
    putAnnot: async (a) => void annots.set(a.id, plain(a)),
    deleteAnnot: async (id) => void annots.delete(id),
    async deleteDoc(doc) {
      docs.delete(doc.id);
      files.delete(doc.fileId);
      for (const [k, a] of annots) if (a.docId === doc.id) annots.delete(k);
    },
    kvGet: async (k) => kv.get(k),
    kvSet: async (k, v) => void kv.set(k, v),
  };
}

export async function openStore() {
  try {
    if (!('indexedDB' in window)) throw new Error('No IndexedDB');
    const db = await openDb();
    // Ask the browser not to evict our data under storage pressure.
    try {
      await navigator.storage?.persist?.();
    } catch {}
    return idbBackend(db);
  } catch (e) {
    console.warn('Falling back to in-memory storage:', e);
    return memoryBackend();
  }
}

export async function storageEstimate() {
  try {
    const e = await navigator.storage?.estimate?.();
    const persisted = await navigator.storage?.persisted?.();
    return e ? { usage: e.usage || 0, quota: e.quota || 0, persisted: !!persisted } : null;
  } catch {
    return null;
  }
}
