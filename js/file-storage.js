const DATABASE_NAME = "brick-keeper";
const STORE_NAME = "settings";
const HANDLE_KEY = "inventory-file-handle";

export function isTauriRuntime(runtime = globalThis) {
  return typeof runtime.__TAURI__?.core?.invoke === "function";
}

export function supportsFileStorage(runtime = globalThis) {
  return isTauriRuntime(runtime)
    || ("showOpenFilePicker" in runtime && "indexedDB" in runtime);
}

export async function pickInventoryFile(runtime = globalThis) {
  if (isTauriRuntime(runtime)) {
    return runtime.__TAURI__.core.invoke("pick_inventory_file");
  }

  const [handle] = await runtime.showOpenFilePicker({
    multiple: false,
    types: [{
      description: "Brick Keeper JSON",
      accept: { "application/json": [".json"] }
    }]
  });
  return handle;
}

export async function getFilePermission(handle, request = false) {
  if (isTauriHandle(handle)) return "granted";

  const options = { mode: "readwrite" };
  const current = await handle.queryPermission(options);
  if (current === "granted" || !request) return current;
  return handle.requestPermission(options);
}

export async function readInventoryFile(handle, runtime = globalThis) {
  if (isTauriHandle(handle)) {
    const contents = await runtime.__TAURI__.core.invoke("read_inventory_file");
    return JSON.parse(contents);
  }

  const file = await handle.getFile();
  return JSON.parse(await file.text());
}

export async function writeInventoryFile(handle, contents, runtime = globalThis) {
  if (isTauriHandle(handle)) {
    await runtime.__TAURI__.core.invoke("write_inventory_file", {
      contents
    });
    return;
  }

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

export async function loadStoredFileHandle(runtime = globalThis) {
  if (!supportsFileStorage(runtime)) return null;

  if (isTauriRuntime(runtime)) {
    return runtime.__TAURI__.core.invoke("get_connected_inventory_file");
  }

  return runTransaction(runtime, "readonly", (store) => store.get(HANDLE_KEY));
}

export async function storeFileHandle(handle, runtime = globalThis) {
  if (isTauriHandle(handle)) {
    await runtime.__TAURI__.core.invoke("confirm_inventory_file");
    return handle;
  }

  return runTransaction(runtime, "readwrite", (store) => store.put(handle, HANDLE_KEY));
}

function isTauriHandle(handle) {
  return handle?.kind === "tauri" && typeof handle.name === "string";
}

function openDatabase(runtime) {
  return new Promise((resolve, reject) => {
    const request = runtime.indexedDB.open(DATABASE_NAME, 1);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(STORE_NAME)) {
        request.result.createObjectStore(STORE_NAME);
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function runTransaction(runtime, mode, operation) {
  const database = await openDatabase(runtime);

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
