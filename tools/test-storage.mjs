import assert from "node:assert/strict";
import {
  APP_VERSION,
  CURRENT_SCHEMA_VERSION,
  migrateInventory,
  requestPersistentStorage,
  serializeInventory,
  validateInventory
} from "../js/storage.js";

const legacyItem = {
  id: "legacy-3001",
  name: "Brick 2 x 4",
  partNumber: "3001",
  category: "bricks",
  color: "red",
  quantity: 4
};

const migratedArray = migrateInventory([legacyItem]);
assert.equal(migratedArray.schemaVersion, CURRENT_SCHEMA_VERSION);
assert.equal(migratedArray.appVersion, APP_VERSION);
assert.equal(migratedArray.items[0].color, "4");
assert.equal(validateInventory(migratedArray), true);

const migratedV1 = migrateInventory({ schemaVersion: 1, items: [legacyItem] });
assert.equal(migratedV1.items[0].color, "4");
assert.equal(validateInventory(migratedV1), true);

const serialized = JSON.parse(serializeInventory(migratedV1.items));
assert.equal(serialized.schemaVersion, 2);
assert.equal(serialized.appVersion, "1.0b");

assert.throws(
  () => migrateInventory({ schemaVersion: 99, items: [] }),
  /newer Brick Keeper version/
);
assert.throws(() => migrateInventory({ schemaVersion: 1 }), /items array/);

let persistCalled = false;
assert.equal(await requestPersistentStorage({
  persisted: async () => false,
  persist: async () => {
    persistCalled = true;
    return true;
  }
}), true);
assert.equal(persistCalled, true);

assert.equal(await requestPersistentStorage({
  persisted: async () => true,
  persist: async () => {
    throw new Error("persist should not be called");
  }
}), true);
assert.equal(await requestPersistentStorage(null), false);

console.log("Storage migration tests passed.");
