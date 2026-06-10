const STORAGE_KEY = "brick-keeper.inventory.v1";

/**
 * Reads the user's working collection from localStorage.
 * Returning null differentiates "no saved collection" from an empty collection.
 */
export function loadStoredInventory() {
  const rawValue = localStorage.getItem(STORAGE_KEY);
  if (rawValue === null) return null;

  try {
    const parsed = JSON.parse(rawValue);
    return validateInventory(parsed) ? parsed.items : null;
  } catch {
    return null;
  }
}

/**
 * Persists a compact, versioned envelope so future schema migrations can be
 * introduced without guessing which data shape a browser contains.
 */
export function saveInventory(items) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify({
    schemaVersion: 1,
    updatedAt: new Date().toISOString(),
    items
  }));
}

/**
 * Checks imported data before it enters application state. It deliberately
 * validates required fields rather than silently accepting malformed records.
 */
export function validateInventory(value) {
  if (!value || value.schemaVersion !== 1 || !Array.isArray(value.items)) return false;

  return value.items.every((item) => (
    typeof item.id === "string" &&
    typeof item.name === "string" &&
    typeof item.partNumber === "string" &&
    typeof item.category === "string" &&
    typeof item.color === "string" &&
    Number.isInteger(item.quantity) &&
    item.quantity >= 0 &&
    (item.image === undefined || item.image === null ||
      (typeof item.image === "string" && item.image.startsWith("data:image/"))) &&
    (item.catalog === undefined || item.catalog === null ||
      (typeof item.catalog.sourceCategory === "string" &&
        typeof item.catalog.material === "string"))
  ));
}

/**
 * Generates the portable JSON document used by the download action.
 */
export function serializeInventory(items) {
  return JSON.stringify({
    schemaVersion: 1,
    exportedAt: new Date().toISOString(),
    items
  }, null, 2);
}
