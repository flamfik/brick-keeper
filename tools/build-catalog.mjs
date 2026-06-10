import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

const sourceDirectory = resolve(process.argv[2] ?? ".cache/brick-db");
const outputDirectory = resolve(process.argv[3] ?? "data/catalog");

const categoryGroups = {
  bricks: new Set([4, 5, 6, 11, 16, 20, 23, 37, 47]),
  plates: new Set([1, 9, 14, 21, 49]),
  tiles: new Set([15, 19, 67]),
  slopes: new Set([3]),
  technic: new Set([8, 12, 17, 22, 25, 26, 40, 44, 45, 46, 51, 52, 53, 54, 55]),
  minifigures: new Set([13, 27, 59, 60, 61, 62, 63, 64, 65, 70, 71, 72, 73])
};

function decodeCsvField(value) {
  const trimmed = value.replace(/\r$/, "");
  return trimmed.startsWith("\"") && trimmed.endsWith("\"")
    ? trimmed.slice(1, -1).replace(/""/g, "\"")
    : trimmed;
}

function parsePartRow(line) {
  const firstComma = line.indexOf(",");
  const lastComma = line.lastIndexOf(",");
  const categoryComma = line.lastIndexOf(",", lastComma - 1);

  if (firstComma < 0 || categoryComma <= firstComma || lastComma <= categoryComma) return [];

  return [
    line.slice(0, firstComma),
    decodeCsvField(line.slice(firstComma + 1, categoryComma)),
    line.slice(categoryComma + 1, lastComma),
    decodeCsvField(line.slice(lastComma + 1))
  ];
}

function getCategoryGroup(categoryId) {
  for (const [group, ids] of Object.entries(categoryGroups)) {
    if (ids.has(categoryId)) return group;
  }
  return "special";
}

function getShard(partNumber) {
  return partNumber.toLowerCase().replace(/[^a-z0-9]/g, "_").padEnd(1, "_").slice(0, 1);
}

const categoryRows = readFileSync(join(sourceDirectory, "part_categories.csv"), "utf8")
  .split(/\r?\n/)
  .filter(Boolean)
  .map((line) => {
    const comma = line.indexOf(",");
    return [line.slice(0, comma), decodeCsvField(line.slice(comma + 1))];
  });
const categories = new Map(categoryRows.slice(1).map(([id, name]) => [Number(id), name]));
const shards = new Map();
let totalParts = 0;
const partLines = readFileSync(join(sourceDirectory, "parts.csv"), "utf8").split(/\r?\n/);

for (const line of partLines.slice(1)) {
  const [partNumber, name, rawCategoryId, material] = parsePartRow(line);
  if (!partNumber || !name) continue;

  totalParts += 1;
  const categoryId = Number(rawCategoryId);
  const shard = getShard(partNumber);
  const record = [
    partNumber,
    name,
    getCategoryGroup(categoryId),
    categories.get(categoryId) ?? "Other",
    material || "Unknown"
  ];

  if (!shards.has(shard)) shards.set(shard, []);
  shards.get(shard).push(record);
}

mkdirSync(outputDirectory, { recursive: true });

for (const [shard, records] of shards) {
  writeFileSync(join(outputDirectory, `${shard}.json`), JSON.stringify(records));
}

writeFileSync(join(outputDirectory, "manifest.json"), JSON.stringify({
  schemaVersion: 1,
  generatedAt: new Date().toISOString(),
  source: "BrickKeeper_DB/parts.csv",
  totalParts,
  shardStrategy: "first-character",
  shards: [...shards.keys()].sort()
}, null, 2));

console.log(`Built ${shards.size} shards with ${totalParts} parts.`);
