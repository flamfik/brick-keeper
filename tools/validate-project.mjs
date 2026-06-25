import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { parseCsvRows } from "../js/csv.js";
import { APP_VERSION, CURRENT_SCHEMA_VERSION, migrateInventory } from "../js/storage.js";

const readText = (path) => readFileSync(path, "utf8").replace(/^\uFEFF/, "");
const readJson = (path) => JSON.parse(readText(path));
const readCsv = (path) => parseCsvRows(readText(path));
const jsonFiles = (directory) => readdirSync(directory)
  .filter((name) => name.endsWith(".json"))
  .sort();
const csvFiles = (directory) => readdirSync(directory)
  .filter((name) => name.endsWith(".csv"))
  .sort();
const assertUnique = (values, label) => {
  const seen = new Set();
  for (const value of values) {
    assert.ok(!seen.has(value), `Duplicate ${label}: ${value}`);
    seen.add(value);
  }
};

const starter = migrateInventory(readJson("data/bricks.json"));
assert.equal(starter.schemaVersion, CURRENT_SCHEMA_VERSION);
assert.equal(starter.appVersion, APP_VERSION);

const colors = readCsv("data/colors.csv");
assert.deepEqual(colors[0], ["id", "name", "hex", "transparent", "partCount"]);
assert.ok(colors.length >= 200, "Color catalog is unexpectedly small.");
assertUnique(colors.slice(1).map(([id]) => id), "color id");

const manifest = new Map(readCsv("data/catalog/manifest.csv").slice(1));
const catalogFiles = csvFiles("data/catalog").filter((name) => name !== "manifest.csv");
assert.ok(catalogFiles.every((name) => /^[a-z0-9_]\.csv$/.test(name)));
const catalogPartNumbers = catalogFiles.flatMap((name) => (
  readCsv(join("data/catalog", name)).slice(1).map(([partNumber]) => partNumber)
));
assert.equal(catalogPartNumbers.length, Number(manifest.get("totalParts")));
assertUnique(catalogPartNumbers, "part number");

const partFiles = csvFiles("data/sets/parts");
const photoFiles = csvFiles("data/sets/photos");
assert.ok(partFiles.every((name) => /^\d{2}\.csv$/.test(name)));
assert.ok(photoFiles.every((name) => /^[a-z0-9_]\.csv$/.test(name)));

const countCsvRecords = (directory, files) => files.reduce(
  (count, name) => count + readCsv(join(directory, name)).length - 1,
  0
);
assert.ok(countCsvRecords("data/sets/parts", partFiles) >= 100_000);
assert.ok(countCsvRecords("data/sets/photos", photoFiles) >= 90_000);

const setIndex = readCsv("data/sets/index.csv");
assert.deepEqual(setIndex[0], ["setNumber", "name", "year", "numParts", "imageUrl", "inventoryId"]);
assert.ok(setIndex.length >= 10_000);
assertUnique(setIndex.slice(1).map(([setNumber]) => setNumber), "set number");
assertUnique(setIndex.slice(1).map((row) => row[5]), "set inventory id");

for (const stalePath of [
  "data/colors.json",
  "data/catalog/manifest.json",
  "data/sets/index.json"
]) {
  assert.ok(!existsSync(stalePath), `Stale reference JSON remains: ${stalePath}`);
}
assert.equal(jsonFiles("data/catalog").length, 0);
assert.equal(jsonFiles("data/sets/parts").length, 0);
assert.equal(jsonFiles("data/sets/photos").length, 0);

const index = readText("index.html");
const app = readText("js/app.js");
const setCatalog = readText("js/set-catalog.js");
const sqlStorage = readText("js/sql-storage.js");
const worker = readText("service-worker.js");
const tauriConfig = readJson("src-tauri/tauri.conf.json");
const tauriSource = readText("src-tauri/src/lib.rs");
const tauriDatabase = readText("src-tauri/src/database.rs");
const sqlSchema = readText("src-tauri/sql/schema.sql");
const expectedToken = `v=${APP_VERSION}`;
assert.ok(index.includes(`styles.css?${expectedToken}`));
assert.ok(index.includes(`js/app.js?${expectedToken}`));
assert.ok(index.includes(`v${APP_VERSION}`));
assert.ok(index.includes('id="part-catalog-suggestions"'));
assert.ok(app.includes(`service-worker.js?${expectedToken}`));
assert.ok(app.includes(`data/colors.csv?${expectedToken}`));
assert.ok(app.includes("searchSqlParts"), "Part catalog lookup is not wired to SQLite.");
assert.ok(setCatalog.includes("searchSqlSets"), "Set search is not wired to SQLite.");
assert.ok(setCatalog.includes("loadSqlSetParts"), "Set inventories are not wired to SQLite.");
assert.ok(setCatalog.includes("findSqlCatalogPhoto"), "Catalog photos are not wired to SQLite.");
assert.ok(worker.includes(`brick-keeper-v${APP_VERSION}`));
assert.equal(tauriConfig.app.withGlobalTauri, true);
assert.equal(tauriConfig.build.frontendDist, "../dist");
for (const command of [
  "database_status",
  "find_sql_catalog_photo",
  "load_color_records",
  "load_inventory_items",
  "load_sql_set_parts",
  "replace_inventory_items",
  "search_catalog_parts",
  "search_set_records",
  "get_connected_inventory_file",
  "pick_inventory_file",
  "confirm_inventory_file",
  "read_inventory_file",
  "write_inventory_file"
]) {
  assert.ok(tauriSource.includes(command), `Missing Tauri command: ${command}`);
}
for (const table of ["inventory_items", "colors", "parts", "sets", "set_parts", "catalog_photos"]) {
  assert.ok(sqlSchema.includes(`CREATE TABLE IF NOT EXISTS ${table}`), `Missing SQL table: ${table}`);
}
assert.ok(tauriDatabase.includes("rusqlite"), "SQLite backend is not wired.");
assert.ok(tauriDatabase.includes("csv::Reader"), "Reference CSV import is not wired to SQLite.");
assert.ok(tauriDatabase.includes("import_reference_data"), "SQLite reference import is missing.");
assert.ok(tauriDatabase.includes("REFERENCE_VERSION"), "SQLite reference versioning is missing.");
assert.ok(sqlStorage.includes("load_color_records"), "SQL storage adapter cannot load colors.");
assert.ok(sqlStorage.includes("search_catalog_parts"), "SQL storage adapter cannot search parts.");
assert.ok(sqlStorage.includes("search_set_records"), "SQL storage adapter cannot search sets.");

for (const source of [index, app, worker]) {
  assert.ok(!source.includes("v=0.9"), "A stale v0.9 asset reference remains.");
}

const shellPaths = [...worker.matchAll(/^\s+"(\.\/[^"?]+)(?:\?[^"]*)?",?$/gm)]
  .map((match) => match[1])
  .filter((path) => path !== "./");
for (const path of shellPaths) {
  assert.ok(existsSync(path.slice(2)), `Missing service-worker asset: ${path}`);
}

console.log("Project data and version validation passed.");
