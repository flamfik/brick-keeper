import assert from "node:assert/strict";
import { groupInventoryByPartNumber, upsertInventoryRecord } from "../js/inventory.js";
import { calculateBuildableSets, calculateMissingParts } from "../js/set-catalog.js";

const existing = {
  id: "existing",
  name: "Brick 2 x 4",
  partNumber: "3001",
  category: "bricks",
  color: "red",
  quantity: 48,
  location: "Box A1",
  year: 1958,
  notes: "",
  image: null,
  catalog: null,
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z"
};
const duplicate = {
  ...existing,
  id: "new",
  partNumber: " 3001 ",
  color: "4",
  quantity: 2,
  updatedAt: "2026-06-10T00:00:00.000Z"
};

const merged = upsertInventoryRecord([existing], duplicate);
assert.equal(merged.merged, true);
assert.equal(merged.items.length, 1);
assert.equal(merged.items[0].quantity, 50);
assert.equal(merged.items[0].color, "4");

const distinctColor = upsertInventoryRecord([existing], {
  ...duplicate,
  id: "blue",
  color: "1"
});
assert.equal(distinctColor.merged, false);
assert.equal(distinctColor.items.length, 2);

const grouped = groupInventoryByPartNumber([
  { partNumber: "3001", color: "4", quantity: 2 },
  { partNumber: " 3001 ", color: "1", quantity: 3 },
  { partNumber: "3020", color: "4", quantity: 1 }
]);
assert.equal(grouped.length, 2);
assert.equal(grouped[0].key, "3001");
assert.equal(grouped[0].quantity, 5);
assert.equal(grouped[0].colorCount, 2);
assert.equal(grouped[0].variants.length, 2);

const missing = calculateMissingParts([
  ["3001", "4", 5],
  ["3020", "1", 2]
], [{
  partNumber: "3001",
  color: "4",
  quantity: 3
}]);
assert.deepEqual(missing, [
  { partNumber: "3001", color: "4", required: 5, owned: 3, missing: 2 },
  { partNumber: "3020", color: "1", required: 2, owned: 0, missing: 2 }
]);

const buildable = calculateBuildableSets([
  ["001-1", "Gears", 1965, 43, "https://example.com/001-1.jpg", 24696],
  ["002-1", "Too many bricks", 1965, 44, "https://example.com/002-1.jpg", 24697],
  ["003-1", "No inventory rows", 1965, 12, "https://example.com/003-1.jpg", 24698]
], new Map([
  ["24696", [["3001", "4", 43]]],
  ["24697", [["3001", "4", 44]]]
]), [{
  partNumber: "3001",
  color: "red",
  quantity: 43
}]);
assert.deepEqual(buildable, [["001-1", "Gears", 1965, 43, "https://example.com/001-1.jpg", 24696]]);

console.log("Inventory duplicate tests passed.");
