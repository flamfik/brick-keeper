import { parseCsvRows } from "./csv.js?v=1.0b";
import {
  findSqlCatalogPhoto,
  loadSqlSetParts,
  searchSqlSets,
  supportsSqlStorage
} from "./sql-storage.js?v=1.0b";

const INDEX_URL = "./data/sets/index.csv?v=2026-06-10";
const PARTS_URL = "./data/sets/parts";
const PHOTOS_URL = "./data/sets/photos";
let indexPromise;
const shardCache = new Map();
const photoCache = new Map();

export async function searchSets(query, limit = 20) {
  const normalized = query.trim().toLocaleLowerCase("en");
  if (!normalized) return [];
  if (supportsSqlStorage()) {
    try {
      return await searchSqlSets(query, limit);
    } catch (error) {
      console.error("SQLite set search failed:", error);
    }
  }

  indexPromise ??= fetch(INDEX_URL)
    .then(checkResponse)
    .then((response) => response.text())
    .then(parseSetIndex);
  const sets = await indexPromise;
  return sets.filter(([number, name]) => (
    number.toLocaleLowerCase("en").includes(normalized) ||
    name.toLocaleLowerCase("en").includes(normalized)
  )).slice(0, limit);
}

export async function loadSetParts(inventoryId) {
  if (supportsSqlStorage()) {
    try {
      return await loadSqlSetParts(inventoryId);
    } catch (error) {
      console.error("SQLite set inventory loading failed:", error);
    }
  }

  const shard = Math.floor(Number(inventoryId) / 10000).toString().padStart(2, "0");
  if (!shardCache.has(shard)) {
    shardCache.set(shard, fetch(`${PARTS_URL}/${shard}.csv?v=2026-06-10`)
      .then(checkResponse)
      .then((response) => response.text())
      .then(parseSetParts));
  }
  return (await shardCache.get(shard)).get(String(inventoryId)) ?? [];
}

export async function findCatalogPhoto(partNumber, colorId) {
  if (supportsSqlStorage()) {
    try {
      return await findSqlCatalogPhoto(partNumber, colorId);
    } catch (error) {
      console.error("SQLite catalog photo lookup failed:", error);
    }
  }

  const normalized = String(partNumber).trim().toLocaleLowerCase("en");
  const shard = normalized.replace(/[^a-z0-9]/g, "_").padEnd(1, "_").slice(0, 1);
  if (!photoCache.has(shard)) {
    photoCache.set(shard, fetch(`${PHOTOS_URL}/${shard}.csv?v=2026-06-10`)
      .then((response) => response.status === 404
        ? new Map()
        : checkResponse(response).text().then(parseCatalogPhotos)));
  }
  const photos = await photoCache.get(shard);
  return photos.get(`${normalized}|${colorId}`) ??
    [...photos.entries()].find(([key]) => key.startsWith(`${normalized}|`))?.[1] ??
    null;
}

export function calculateMissingParts(requiredParts, inventory) {
  const owned = new Map();
  inventory.forEach((item) => {
    const key = `${item.partNumber.trim().toLocaleLowerCase("en")}|${item.color}`;
    owned.set(key, (owned.get(key) ?? 0) + item.quantity);
  });

  return requiredParts.map(([partNumber, color, required]) => {
    const key = `${partNumber.toLocaleLowerCase("en")}|${color}`;
    const quantity = owned.get(key) ?? 0;
    return { partNumber, color, required, owned: quantity, missing: Math.max(0, required - quantity) };
  }).filter((part) => part.missing > 0);
}

function checkResponse(response) {
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return response;
}

function parseSetIndex(text) {
  return parseCsvRows(text).slice(1).map(([number, name, year, parts, image, inventoryId]) => [
    number,
    name,
    Number(year),
    Number(parts),
    image,
    Number(inventoryId)
  ]).filter(([number, name]) => number && name);
}

function parseSetParts(text) {
  const grouped = new Map();
  for (const [inventoryId, partNumber, color, quantity] of parseCsvRows(text).slice(1)) {
    if (!inventoryId || !partNumber) continue;
    if (!grouped.has(inventoryId)) grouped.set(inventoryId, []);
    grouped.get(inventoryId).push([partNumber, color, Number(quantity)]);
  }
  return grouped;
}

function parseCatalogPhotos(text) {
  return new Map(parseCsvRows(text)
    .slice(1)
    .filter(([partNumber, color, image]) => partNumber && color && image)
    .map(([partNumber, color, image]) => [
      `${partNumber.toLocaleLowerCase("en")}|${color}`,
      image
    ]));
}
