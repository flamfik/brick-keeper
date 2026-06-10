import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { APP_VERSION, CURRENT_SCHEMA_VERSION, migrateInventory } from "../js/storage.js";

const readText = (path) => readFileSync(path, "utf8").replace(/^\uFEFF/, "");
const readJson = (path) => JSON.parse(readText(path));
const jsonFiles = (directory) => readdirSync(directory)
  .filter((name) => name.endsWith(".json"))
  .sort();

const starter = migrateInventory(readJson("data/bricks.json"));
assert.equal(starter.schemaVersion, CURRENT_SCHEMA_VERSION);
assert.equal(starter.appVersion, APP_VERSION);

const colors = readJson("data/colors.json");
assert.equal(colors.schemaVersion, 1);
assert.ok(colors.colors.length >= 200, "Color catalog is unexpectedly small.");

const manifest = readJson("data/catalog/manifest.json");
const catalogFiles = jsonFiles("data/catalog").filter((name) => name !== "manifest.json");
assert.ok(catalogFiles.every((name) => /^[a-z0-9_]\.json$/.test(name)));
const catalogCount = catalogFiles.reduce(
  (count, name) => count + readJson(join("data/catalog", name)).length,
  0
);
assert.equal(catalogCount, manifest.totalParts);

const partFiles = jsonFiles("data/sets/parts");
const photoFiles = jsonFiles("data/sets/photos");
assert.ok(partFiles.every((name) => /^\d{2}\.json$/.test(name)));
assert.ok(photoFiles.every((name) => /^[a-z0-9_]\.json$/.test(name)));

const countObjectKeys = (directory, files) => files.reduce(
  (count, name) => count + Object.keys(readJson(join(directory, name))).length,
  0
);
assert.ok(countObjectKeys("data/sets/parts", partFiles) >= 30_000);
assert.ok(countObjectKeys("data/sets/photos", photoFiles) >= 90_000);

const setIndex = readJson("data/sets/index.json");
assert.ok(Array.isArray(setIndex.sets) && setIndex.sets.length >= 10_000);

const index = readText("index.html");
const app = readText("js/app.js");
const worker = readText("service-worker.js");
const expectedToken = `v=${APP_VERSION}`;
assert.ok(index.includes(`styles.css?${expectedToken}`));
assert.ok(index.includes(`js/app.js?${expectedToken}`));
assert.ok(index.includes(`v${APP_VERSION}`));
assert.ok(app.includes(`service-worker.js?${expectedToken}`));
assert.ok(worker.includes(`brick-keeper-v${APP_VERSION}`));

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
