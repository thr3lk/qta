const DB_NAME = "qta-media";
const STORE = "media";

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) {
        db.createObjectStore(STORE, { keyPath: "transcriptId" });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error("media store open failed"));
  });
}

export async function saveMediaFile(transcriptId: string, file: File): Promise<void> {
  const db = await openDb();
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE, "readwrite");
      tx.objectStore(STORE).put({ transcriptId, file });
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error ?? new Error("media save failed"));
      tx.onabort = () => reject(tx.error ?? new Error("media save aborted"));
    });
  } finally {
    db.close();
  }
}

export async function loadMediaFile(transcriptId: string): Promise<File | null> {
  const db = await openDb();
  try {
    return await new Promise<File | null>((resolve, reject) => {
      const tx = db.transaction(STORE, "readonly");
      const req = tx.objectStore(STORE).get(transcriptId);
      req.onsuccess = () => {
        const file = req.result?.file;
        resolve(file instanceof File ? file : null);
      };
      req.onerror = () => reject(req.error ?? new Error("media load failed"));
    });
  } finally {
    db.close();
  }
}

export async function deleteMediaFile(transcriptId: string): Promise<void> {
  const db = await openDb();
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE, "readwrite");
      tx.objectStore(STORE).delete(transcriptId);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error ?? new Error("media delete failed"));
    });
  } finally {
    db.close();
  }
}

export async function pruneMediaFiles(keepIds: Set<string>): Promise<void> {
  const db = await openDb();
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE, "readwrite");
      const keysReq = tx.objectStore(STORE).getAllKeys();
      keysReq.onsuccess = () => {
        const store = tx.objectStore(STORE);
        for (const key of keysReq.result) {
          if (!keepIds.has(String(key))) store.delete(key);
        }
      };
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error ?? new Error("media prune failed"));
    });
  } finally {
    db.close();
  }
}
