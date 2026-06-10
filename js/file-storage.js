const DATABASE_NAME = "brick-keeper";
const STORE_NAME = "settings";
const HANDLE_KEY = "inventory-file-handle";

export function supportsFileStorage() {
  return "showOpenFilePicker" in window && "indexedDB" in window;
}

export async function pickInventoryFile() {
  const [handle] = await window.showOpenFilePicker({
    multiple: false,
    types: [{
      description: "Brick Keeper JSON",
      accept: { "application/json": [".json"] }
    }]
  });
  return handle;
}

export async function getFilePermission(handle, request = false) {
  const options = { mode: "readwrite" };
  const current = await handle.queryPermission(options);
  if (current === "granted" || !request) return current;
  return handle.requestPermission(options);
}

export async function readInventoryFile(handle) {
  const file = await handle.getFile();
  return JSON.parse(await file.text());
}

export async function writeInventoryFile(handle, contents) {
  const writable = await handle.createWritable();
  try {
    await writable.write(contents);
    await writable.close();
  } catch (error) {
    try {
      await writable.abort();
    } catch {
      // The stream may already be closed after a failed close operation.
    }
    throw error;
  }
}

export async function loadStoredFileHandle() {
  if (!supportsFileStorage()) return null;
  return runTransaction("readonly", (store) => store.get(HANDLE_KEY));
}

export async function storeFileHandle(handle) {
  return runTransaction("readwrite", (store) => store.put(handle, HANDLE_KEY));
}

function openDatabase() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DATABASE_NAME, 1);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(STORE_NAME)) {
        request.result.createObjectStore(STORE_NAME);
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function runTransaction(mode, operation) {
  const database = await openDatabase();

  try {
    return await new Promise((resolve, reject) => {
      const transaction = database.transaction(STORE_NAME, mode);
      const request = operation(transaction.objectStore(STORE_NAME));
      let result = null;
      request.onsuccess = () => {
        result = request.result ?? null;
      };
      request.onerror = () => reject(request.error);
      transaction.oncomplete = () => resolve(result);
      transaction.onabort = () => reject(transaction.error);
      transaction.onerror = () => reject(transaction.error);
    });
  } finally {
    database.close();
  }
}
