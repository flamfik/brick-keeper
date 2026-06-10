const INDEX_URL = "./data/sets/index.json?v=2026-06-10";
const PARTS_URL = "./data/sets/parts";
const PHOTOS_URL = "./data/sets/photos";
let indexPromise;
const shardCache = new Map();
const photoCache = new Map();

export async function searchSets(query, limit = 20) {
  const normalized = query.trim().toLocaleLowerCase("en");
  if (!normalized) return [];
  indexPromise ??= fetch(INDEX_URL).then(checkResponse).then((response) => response.json());
  const { sets } = await indexPromise;
  return sets.filter(([number, name]) => (
    number.toLocaleLowerCase("en").includes(normalized) ||
    name.toLocaleLowerCase("en").includes(normalized)
  )).slice(0, limit);
}

export async function loadSetParts(inventoryId) {
  const shard = Math.floor(Number(inventoryId) / 10000).toString().padStart(2, "0");
  if (!shardCache.has(shard)) {
    shardCache.set(shard, fetch(`${PARTS_URL}/${shard}.json?v=2026-06-10`)
      .then(checkResponse).then((response) => response.json()));
  }
  return (await shardCache.get(shard))[String(inventoryId)] ?? [];
}

export async function findCatalogPhoto(partNumber, colorId) {
  const normalized = String(partNumber).trim().toLocaleLowerCase("en");
  const shard = normalized.replace(/[^a-z0-9]/g, "_").padEnd(1, "_").slice(0, 1);
  if (!photoCache.has(shard)) {
    photoCache.set(shard, fetch(`${PHOTOS_URL}/${shard}.json?v=2026-06-10`)
      .then((response) => response.status === 404 ? {} : checkResponse(response).json()));
  }
  const photos = await photoCache.get(shard);
  return photos[`${normalized}|${colorId}`] ??
    Object.entries(photos).find(([key]) => key.startsWith(`${normalized}|`))?.[1] ??
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
