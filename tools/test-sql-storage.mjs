import assert from "node:assert/strict";
import {
  findSqlBuildableSets,
  findSqlCatalogPhoto,
  getDatabaseStatus,
  loadSqlColors,
  loadSqlInventory,
  loadSqlSetParts,
  replaceSqlInventory,
  searchSqlParts,
  searchSqlSets,
  supportsSqlStorage
} from "../js/sql-storage.js";

const calls = [];
const items = [{
  id: "brick-1",
  name: "Brick 2 x 4",
  partNumber: "3001",
  category: "bricks",
  color: "4",
  quantity: 2,
  location: "",
  year: null,
  notes: "",
  image: null,
  catalogImage: null,
  catalog: null,
  createdAt: "2026-06-25T00:00:00.000Z",
  updatedAt: "2026-06-25T00:00:00.000Z"
}];
const runtime = {
  __TAURI__: {
    core: {
      invoke: async (command, payload) => {
        calls.push([command, payload]);
        if (command === "database_status") {
          return { path: "brick-keeper.sqlite3", inventoryItems: 1 };
        }
        if (command === "load_inventory_items") return items;
        if (command === "load_color_records") {
          return [{ id: "4", name: "Red", hex: "#C91A09", transparent: false, partCount: 123 }];
        }
        if (command === "search_catalog_parts") {
          return [{
            partNumber: "3001",
            name: "Brick 2 x 4",
            category: "bricks",
            sourceCategory: "Brick",
            material: "Plastic"
          }];
        }
        if (command === "search_set_records") {
          return [{
            setNumber: "75192-1",
            name: "Millennium Falcon",
            year: 2017,
            numParts: 7541,
            imageUrl: "https://example.com/75192.jpg",
            inventoryId: 196945
          }];
        }
        if (command === "find_buildable_set_records") {
          return [{
            setNumber: "001-1",
            name: "Gears",
            year: 1965,
            numParts: 43,
            imageUrl: "https://example.com/001-1.jpg",
            inventoryId: 24696
          }];
        }
        if (command === "load_sql_set_parts") {
          return [{ partNumber: "3001", color: "4", quantity: 2 }];
        }
        if (command === "find_sql_catalog_photo") {
          return "https://example.com/3001.jpg";
        }
        return null;
      }
    }
  }
};

assert.equal(supportsSqlStorage(runtime), true);
assert.deepEqual(await getDatabaseStatus(runtime), {
  path: "brick-keeper.sqlite3",
  inventoryItems: 1
});
assert.deepEqual(await loadSqlInventory(runtime), items);

await replaceSqlInventory(items, runtime);
assert.deepEqual(calls.at(-1), ["replace_inventory_items", { items }]);

assert.deepEqual(await loadSqlColors(runtime), [["4", "Red", "#C91A09", false, 123]]);
assert.deepEqual(await searchSqlParts("300", 10, runtime), [[
  "3001",
  "Brick 2 x 4",
  "bricks",
  "Brick",
  "Plastic"
]]);
assert.deepEqual(calls.at(-1), ["search_catalog_parts", { query: "300", limit: 10 }]);
assert.deepEqual(await searchSqlSets("75192", 5, runtime), [[
  "75192-1",
  "Millennium Falcon",
  2017,
  7541,
  "https://example.com/75192.jpg",
  196945
]]);
assert.deepEqual(await findSqlBuildableSets(25, runtime), [[
  "001-1",
  "Gears",
  1965,
  43,
  "https://example.com/001-1.jpg",
  24696
]]);
assert.deepEqual(calls.at(-1), ["find_buildable_set_records", { limit: 25 }]);
assert.deepEqual(await loadSqlSetParts(196945, runtime), [["3001", "4", 2]]);
assert.deepEqual(calls.at(-1), ["load_sql_set_parts", { inventoryId: 196945 }]);
assert.equal(await findSqlCatalogPhoto("3001", "4", runtime), "https://example.com/3001.jpg");
assert.deepEqual(calls.at(-1), [
  "find_sql_catalog_photo",
  { partNumber: "3001", color: "4" }
]);

console.log("SQLite storage adapter tests passed.");
