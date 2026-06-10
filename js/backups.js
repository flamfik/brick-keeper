const DATABASE_NAME = "brick-keeper-backups";
const STORE_NAME = "snapshots";
const MAX_SNAPSHOTS = 20;

function openDatabase() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DATABASE_NAME, 1);
    request.onupgradeneeded = () => {
      request.result.createObjectStore(STORE_NAME, { keyPath: "createdAt" });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function runTransaction(mode, operation) {
  return openDatabase().then((database) => new Promise((resolve, reject) => {
    const transaction = database.transaction(STORE_NAME, mode);
    const store = transaction.objectStore(STORE_NAME);
    const result = operation(store);
    transaction.oncomplete = () => {
      database.close();
      resolve(result);
    };
    transaction.onerror = () => reject(transaction.error);
  }));
}

/**
 * Saves the state before a mutation. Consecutive identical states are skipped,
 * and old snapshots are trimmed so backups cannot grow without a limit.
 */
export async function saveSnapshot(items, reason) {
  const snapshots = await listSnapshots();
  const serialized = JSON.stringify(items);
  if (snapshots[0]?.serialized === serialized) return;

  await runTransaction("readwrite", (store) => {
    store.put({
      createdAt: new Date().toISOString(),
      reason,
      serialized
    });
    snapshots.slice(MAX_SNAPSHOTS - 1).forEach((snapshot) => store.delete(snapshot.createdAt));
  });
}

export async function listSnapshots() {
  const database = await openDatabase();
  return new Promise((resolve, reject) => {
    const transaction = database.transaction(STORE_NAME, "readonly");
    const request = transaction.objectStore(STORE_NAME).getAll();
    request.onsuccess = () => {
      database.close();
      resolve(request.result.sort((a, b) => b.createdAt.localeCompare(a.createdAt)));
    };
    request.onerror = () => reject(request.error);
  });
}

export async function takeLatestSnapshot() {
  const [latest] = await listSnapshots();
  if (!latest) return null;
  await runTransaction("readwrite", (store) => store.delete(latest.createdAt));
  return JSON.parse(latest.serialized);
}
