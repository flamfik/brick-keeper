import assert from "node:assert/strict";
import {
  configureMysqlDatabase,
  findMysqlBuildableSets,
  getMysqlStatus,
  loadMysqlInventory,
  replaceMysqlInventory
} from "../js/mysql-storage.js";

const calls = [];
const items = [{
  id: "brick-1",
  name: "Brick 2 x 4",
  partNumber: "3001",
  category: "bricks",
  color: "4",
  quantity: 2
}];

const runtime = {
  fetch: async (url, options = {}) => {
    calls.push([url, options]);
    if (url.includes("database.php?action=status")) {
      return jsonResponse({
        ok: true,
        configured: true,
        connected: true,
        schemaReady: true,
        config: { host: "127.0.0.1", port: 3306, database: "brick_keeper", username: "root" }
      });
    }
    if (url.includes("database.php?action=configure")) {
      return jsonResponse({ ok: true, connected: true, schemaReady: true });
    }
    if (url.includes("inventory.php") && options.method === "PUT") {
      return jsonResponse({ ok: true, count: items.length });
    }
    if (url.includes("inventory.php")) {
      return jsonResponse({ ok: true, schemaVersion: 2, items });
    }
    if (url.includes("sets.php?action=buildable")) {
      return jsonResponse({
        ok: true,
        referenceReady: true,
        sets: [{
          setNumber: "001-1",
          name: "Gears",
          year: 1965,
          numParts: 43,
          imageUrl: "https://example.com/001-1.jpg",
          inventoryId: 24696
        }]
      });
    }
    return jsonResponse({ ok: false, error: "not found" }, 404);
  }
};

assert.deepEqual(await getMysqlStatus(runtime), {
  ok: true,
  configured: true,
  connected: true,
  schemaReady: true,
  config: { host: "127.0.0.1", port: 3306, database: "brick_keeper", username: "root" }
});

await configureMysqlDatabase({
  host: "127.0.0.1",
  port: 3306,
  database: "brick_keeper",
  username: "root",
  password: "",
  createDatabase: true
}, runtime);
assert.equal(calls.at(-1)[1].method, "POST");

assert.deepEqual(await loadMysqlInventory(runtime), items);

await replaceMysqlInventory(items, runtime);
assert.equal(calls.at(-1)[0], "./api/inventory.php");
assert.equal(calls.at(-1)[1].method, "PUT");
assert.deepEqual(JSON.parse(calls.at(-1)[1].body), { items });

assert.deepEqual(await findMysqlBuildableSets(25, runtime), {
  referenceReady: true,
  sets: [["001-1", "Gears", 1965, 43, "https://example.com/001-1.jpg", 24696]]
});
assert.equal(calls.at(-1)[0], "./api/sets.php?action=buildable&limit=25");

console.log("MySQL storage adapter tests passed.");

function jsonResponse(payload, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => payload
  };
}
