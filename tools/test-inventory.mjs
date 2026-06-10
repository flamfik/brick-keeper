import assert from "node:assert/strict";
import { upsertInventoryRecord } from "../js/inventory.js";

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

console.log("Inventory duplicate tests passed.");
