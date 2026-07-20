import { canonicalColorId } from "./inventory.js?v=1.0b-grouped-colors";

const STORAGE_KEY = "brick-keeper.inventory.v1";
export const APP_VERSION = "1.0b";
export const CURRENT_SCHEMA_VERSION = 2;

/**
 * Reads and migrates the browser mirror. Invalid data is ignored so the
 * application can fall back to a connected file or the starter collection.
 */
export function loadStoredInventory() {
  const rawValue = localStorage.getItem(STORAGE_KEY);
  if (rawValue === null) return null;

  try {
    const document = migrateInventory(JSON.parse(rawValue));
    localStorage.setItem(STORAGE_KEY, JSON.stringify(document));
    return document.items;
  } catch {
    return null;
  }
}

/**
 * Persists the current schema even when the caller received records from an
 * older import. Keeping one canonical mirror simplifies later migrations.
 */
export function saveInventory(items) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(createInventoryDocument(items, "updatedAt")));
}

/**
 * Upgrades every supported historical shape to the current document schema.
 * Version 0 represents early exports that contained only an array of items.
 */
export function migrateInventory(value) {
  let document = Array.isArray(value)
    ? { schemaVersion: 0, items: value }
    : value;

  if (!document || typeof document !== "object" || !Array.isArray(document.items)) {
    throw new TypeError("Inventory document must contain an items array.");
  }

  if (document.schemaVersion === undefined) {
    document = { ...document, schemaVersion: 0 };
  }

  if (!Number.isInteger(document.schemaVersion) || document.schemaVersion < 0) {
    throw new TypeError("Inventory schema version is invalid.");
  }

  if (document.schemaVersion > CURRENT_SCHEMA_VERSION) {
    throw new TypeError("Inventory was created by a newer Brick Keeper version.");
  }

  if (document.schemaVersion === 0) {
    document = {
      schemaVersion: 1,
      updatedAt: document.updatedAt,
      exportedAt: document.exportedAt,
      items: document.items
    };
  }

  if (document.schemaVersion === 1) {
    document = {
      schemaVersion: 2,
      appVersion: APP_VERSION,
      updatedAt: document.updatedAt,
      exportedAt: document.exportedAt,
      items: document.items.map(migrateItemToVersion2)
    };
  }

  const current = {
    ...document,
    schemaVersion: CURRENT_SCHEMA_VERSION,
    appVersion: APP_VERSION,
    items: document.items.map(migrateItemToVersion2)
  };

  if (!validateInventory(current)) {
    throw new TypeError("Inventory document does not match the current schema.");
  }

  return current;
}

/**
 * Validates the current portable format after migrations have run.
 */
export function validateInventory(value) {
  if (
    !value ||
    value.schemaVersion !== CURRENT_SCHEMA_VERSION ||
    typeof value.appVersion !== "string" ||
    !Array.isArray(value.items)
  ) {
    return false;
  }

  return value.items.every(validateItem);
}

/**
 * Generates the portable JSON document used by downloads and connected files.
 */
export function serializeInventory(items) {
  return JSON.stringify(createInventoryDocument(items, "exportedAt"), null, 2);
}

/**
 * Requests protection from automatic storage eviction. Browsers decide whether
 * to grant it; failure never blocks normal local or connected-file storage.
 */
export async function requestPersistentStorage(storageManager = globalThis.navigator?.storage) {
  if (!storageManager?.persist) return false;

  try {
    if (storageManager.persisted && await storageManager.persisted()) return true;
    return await storageManager.persist();
  } catch {
    return false;
  }
}

function createInventoryDocument(items, timestampField) {
  return {
    schemaVersion: CURRENT_SCHEMA_VERSION,
    appVersion: APP_VERSION,
    [timestampField]: new Date().toISOString(),
    items: items.map(migrateItemToVersion2)
  };
}

function migrateItemToVersion2(item) {
  if (!item || typeof item !== "object") return item;
  return {
    ...item,
    color: typeof item.color === "string" ? canonicalColorId(item.color) : item.color
  };
}

function validateItem(item) {
  return (
    item &&
    typeof item.id === "string" &&
    typeof item.name === "string" &&
    typeof item.partNumber === "string" &&
    typeof item.category === "string" &&
    typeof item.color === "string" &&
    Number.isInteger(item.quantity) &&
    item.quantity >= 0 &&
    isOptionalString(item.location) &&
    (item.year === undefined || item.year === null || Number.isInteger(item.year)) &&
    isOptionalString(item.notes) &&
    isOptionalString(item.createdAt) &&
    isOptionalString(item.updatedAt) &&
    (item.image === undefined || item.image === null ||
      (typeof item.image === "string" && item.image.startsWith("data:image/"))) &&
    (item.catalogImage === undefined || item.catalogImage === null ||
      (typeof item.catalogImage === "string" && item.catalogImage.startsWith("https://"))) &&
    (item.catalog === undefined || item.catalog === null ||
      (typeof item.catalog === "object" &&
        typeof item.catalog.sourceCategory === "string" &&
        typeof item.catalog.material === "string"))
  );
}

function isOptionalString(value) {
  return value === undefined || value === null || typeof value === "string";
}
