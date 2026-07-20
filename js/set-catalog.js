import { parseCsvRows } from "./csv.js?v=1.0b-grouped-colors";
import { canonicalColorId, normalizePartNumber } from "./inventory.js?v=1.0b-grouped-colors";
import { findMysqlBuildableSets } from "./mysql-storage.js?v=1.0b-grouped-colors";
import {
  findSqlCatalogPhoto,
  findSqlBuildableSets,
  loadSqlSetParts,
  searchSqlSets,
  supportsSqlStorage
} from "./sql-storage.js?v=1.0b-grouped-colors";

const INDEX_URL = "./data/sets/index.csv?v=2026-06-10";
const PARTS_URL = "./data/sets/parts";
const PHOTOS_URL = "./data/sets/photos";
const DEFAULT_BUILDABLE_LIMIT = 50;
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

  const sets = await loadSetIndex();
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

  return loadSetPartsFromCsv(inventoryId);
}

export async function findBuildableSets(inventory, options = {}) {
  const {
    limit = DEFAULT_BUILDABLE_LIMIT,
    useSql = false,
    useMysql = false,
    onProgress
  } = options;
  const normalizedLimit = Math.max(1, Math.min(200, Number(limit) || DEFAULT_BUILDABLE_LIMIT));

  if (useSql && supportsSqlStorage()) {
    try {
      return await findSqlBuildableSets(normalizedLimit);
    } catch (error) {
      console.error("SQLite buildable set lookup failed:", error);
    }
  }

  if (useMysql) {
    try {
      const result = await findMysqlBuildableSets(normalizedLimit);
      if (result.referenceReady) return result.sets;
    } catch (error) {
      console.error("MySQL buildable set lookup failed:", error);
    }
  }

  return findBuildableSetsFromCsv(inventory, normalizedLimit, onProgress);
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
  const owned = createOwnedPartMap(inventory);

  return requiredParts.map(([partNumber, color, required]) => {
    const normalizedColor = canonicalColorId(color);
    const quantity = owned.get(partKey(normalizePartNumber(partNumber), normalizedColor)) ?? 0;
    return {
      partNumber,
      color: normalizedColor,
      required,
      owned: quantity,
      missing: Math.max(0, required - quantity)
    };
  }).filter((part) => part.missing > 0);
}

export function calculateBuildableSets(setRecords, partsByInventoryId, inventory, limit = DEFAULT_BUILDABLE_LIMIT) {
  const owned = createOwnedPartMap(inventory);
  return setRecords
    .filter((set) => canBuildRequiredParts(partsByInventoryId.get(String(set[5])) ?? [], owned))
    .sort(compareSetsBySize)
    .slice(0, Math.max(1, limit));
}

function createOwnedPartMap(inventory) {
  const owned = new Map();
  inventory.forEach((item) => {
    const partNumber = normalizePartNumber(item.partNumber);
    const color = canonicalColorId(item.color);
    const quantity = Number(item.quantity);
    if (!partNumber || !color || !Number.isFinite(quantity) || quantity <= 0) return;

    const key = partKey(partNumber, color);
    owned.set(key, (owned.get(key) ?? 0) + quantity);
  });
  return owned;
}

function canBuildRequiredParts(requiredParts, owned) {
  return requiredParts.length > 0 && requiredParts.every(([partNumber, color, required]) => {
    const quantity = Number(required);
    if (!Number.isFinite(quantity) || quantity <= 0) return true;
    const key = partKey(normalizePartNumber(partNumber), canonicalColorId(color));
    return (owned.get(key) ?? 0) >= quantity;
  });
}

async function findBuildableSetsFromCsv(inventory, limit, onProgress) {
  const owned = createOwnedPartMap(inventory);
  const totalOwned = [...owned.values()].reduce((sum, quantity) => sum + quantity, 0);
  if (totalOwned <= 0) return [];

  const candidates = (await loadSetIndex())
    .filter((set) => set[3] > 0 && set[3] <= totalOwned)
    .sort(compareSetsBySize);
  const buildable = [];
  let checked = 0;

  for (const set of candidates) {
    const requiredParts = await loadSetPartsFromCsv(set[5]);
    checked += 1;
    if (canBuildRequiredParts(requiredParts, owned)) {
      buildable.push(set);
      if (buildable.length >= limit) break;
    }
    if (onProgress && (checked === candidates.length || checked % 25 === 0)) {
      onProgress({ checked, total: candidates.length, found: buildable.length });
      await yieldToBrowser();
    }
  }

  return buildable;
}

function loadSetIndex() {
  indexPromise ??= fetch(INDEX_URL)
    .then(checkResponse)
    .then((response) => response.text())
    .then(parseSetIndex);
  return indexPromise;
}

async function loadSetPartsFromCsv(inventoryId) {
  const shard = Math.floor(Number(inventoryId) / 10000).toString().padStart(2, "0");
  return (await loadSetPartShard(shard)).get(String(inventoryId)) ?? [];
}

function loadSetPartShard(shard) {
  if (!shardCache.has(shard)) {
    shardCache.set(shard, fetch(`${PARTS_URL}/${shard}.csv?v=2026-06-10`)
      .then(checkResponse)
      .then((response) => response.text())
      .then(parseSetParts));
  }
  return shardCache.get(shard);
}

function compareSetsBySize(a, b) {
  return (Number(b[3]) || 0) - (Number(a[3]) || 0) ||
    String(a[0]).localeCompare(String(b[0]), "en", { sensitivity: "base" });
}

function partKey(partNumber, color) {
  return `${partNumber}|${color}`;
}

function yieldToBrowser() {
  return new Promise((resolve) => setTimeout(resolve, 0));
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
