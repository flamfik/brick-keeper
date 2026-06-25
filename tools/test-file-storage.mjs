import assert from "node:assert/strict";
import {
  getFilePermission,
  isTauriRuntime,
  loadStoredFileHandle,
  pickInventoryFile,
  readInventoryFile,
  storeFileHandle,
  supportsFileStorage,
  writeInventoryFile
} from "../js/file-storage.js";

const calls = [];
const handle = {
  kind: "tauri",
  name: "bricks.json"
};
const runtime = {
  __TAURI__: {
    core: {
      invoke: async (command, payload) => {
        calls.push([command, payload]);
        if (command === "pick_inventory_file") return handle;
        if (command === "get_connected_inventory_file") return handle;
        if (command === "read_inventory_file") return '{"schemaVersion":2,"items":[]}';
        return null;
      }
    }
  }
};

assert.equal(isTauriRuntime(runtime), true);
assert.equal(supportsFileStorage(runtime), true);
assert.equal(supportsFileStorage({ showOpenFilePicker() {}, indexedDB: {} }), true);
assert.deepEqual(await pickInventoryFile(runtime), handle);
assert.equal(await getFilePermission(handle, true), "granted");
assert.deepEqual(await readInventoryFile(handle, runtime), { schemaVersion: 2, items: [] });

await writeInventoryFile(handle, "{}", runtime);
assert.deepEqual(calls.at(-1), [
  "write_inventory_file",
  { contents: "{}" }
]);

await storeFileHandle(handle, runtime);
assert.equal(calls.at(-1)[0], "confirm_inventory_file");
assert.deepEqual(await loadStoredFileHandle(runtime), handle);

console.log("Tauri and browser file-storage adapter tests passed.");
