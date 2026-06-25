import { mkdirSync, readFileSync, readdirSync, unlinkSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { parseCsvRows, stringifyCsvRows } from "../js/csv.js";

const sourceDirectory = resolve(process.argv[2] ?? ".cache/brick-db");
const outputDirectory = resolve(process.argv[3] ?? "data/sets");
const partsOutput = join(outputDirectory, "parts");
const photosOutput = join(outputDirectory, "photos");

mkdirSync(partsOutput, { recursive: true });
mkdirSync(photosOutput, { recursive: true });
cleanCsvFiles(outputDirectory);
cleanCsvFiles(partsOutput);
cleanCsvFiles(photosOutput);

function cleanCsvFiles(directory) {
  for (const file of readdirSync(directory).filter((name) => name.endsWith(".csv"))) {
    unlinkSync(join(directory, file));
  }
}

function readTable(name) {
  const [headers, ...rows] = parseCsvRows(readFileSync(join(sourceDirectory, name), "utf8"));
  return rows.map((row) => Object.fromEntries(headers.map((header, index) => [header, row[index] ?? ""])));
}

function getPartShard(partNumber) {
  return partNumber.toLocaleLowerCase("en").replace(/[^a-z0-9]/g, "_").padEnd(1, "_").slice(0, 1);
}

const inventoryBySet = new Map();
for (const row of readTable("inventories.csv")) {
  const version = Number(row.version);
  const current = inventoryBySet.get(row.set_num);
  if (!current || version > current.version) {
    inventoryBySet.set(row.set_num, { id: Number(row.id), version });
  }
}

const sets = readTable("sets.csv")
  .map((row) => {
    const inventory = inventoryBySet.get(row.set_num);
    return inventory ? [
      row.set_num,
      row.name,
      Number(row.year),
      Number(row.num_parts),
      row.img_url,
      inventory.id
    ] : null;
  })
  .filter(Boolean);

writeFileSync(join(outputDirectory, "index.csv"), stringifyCsvRows([
  ["setNumber", "name", "year", "numParts", "imageUrl", "inventoryId"],
  ...sets
]));

const partShards = new Map();
const photoShards = new Map();
const seenPhotos = new Set();

for (const row of readTable("inventory_parts.csv")) {
  if (row.is_spare === "True") continue;

  const inventoryId = String(row.inventory_id);
  const partNumber = row.part_num;
  const color = row.color_id;
  const quantity = Number(row.quantity);
  const partShard = Math.floor(Number(inventoryId) / 10000).toString().padStart(2, "0");
  if (!partShards.has(partShard)) {
    partShards.set(partShard, [["inventoryId", "partNumber", "color", "quantity"]]);
  }
  partShards.get(partShard).push([inventoryId, partNumber, color, quantity]);

  if (row.img_url) {
    const photoShard = getPartShard(partNumber);
    const key = `${partNumber.toLocaleLowerCase("en")}|${color}`;
    if (!seenPhotos.has(key)) {
      seenPhotos.add(key);
      if (!photoShards.has(photoShard)) {
        photoShards.set(photoShard, [["partNumber", "color", "imageUrl"]]);
      }
      photoShards.get(photoShard).push([partNumber, color, row.img_url]);
    }
  }
}

for (const [shard, rows] of partShards) {
  writeFileSync(join(partsOutput, `${shard}.csv`), stringifyCsvRows(rows));
}

for (const [shard, rows] of photoShards) {
  writeFileSync(join(photosOutput, `${shard}.csv`), stringifyCsvRows(rows));
}

console.log(`Generated ${sets.length} sets, ${partShards.size} part shards and ${photoShards.size} photo shards.`);
