export function supportsSqlStorage(runtime = globalThis) {
  return typeof runtime.__TAURI__?.core?.invoke === "function";
}

function invoke(command, payload, runtime) {
  return runtime.__TAURI__.core.invoke(command, payload);
}

export async function getDatabaseStatus(runtime = globalThis) {
  return invoke("database_status", undefined, runtime);
}

export async function loadSqlInventory(runtime = globalThis) {
  return invoke("load_inventory_items", undefined, runtime);
}

export async function replaceSqlInventory(items, runtime = globalThis) {
  await invoke("replace_inventory_items", { items }, runtime);
}

export async function loadSqlColors(runtime = globalThis) {
  const colors = await invoke("load_color_records", undefined, runtime);
  return colors.map(({ id, name, hex, transparent, partCount }) => [
    id,
    name,
    hex,
    Boolean(transparent),
    Number(partCount)
  ]);
}

export async function searchSqlParts(query, limit = 20, runtime = globalThis) {
  const parts = await invoke("search_catalog_parts", { query, limit }, runtime);
  return parts.map(({ partNumber, name, category, sourceCategory, material }) => [
    partNumber,
    name,
    category,
    sourceCategory,
    material
  ]);
}

export async function searchSqlSets(query, limit = 20, runtime = globalThis) {
  const sets = await invoke("search_set_records", { query, limit }, runtime);
  return sets.map(({ setNumber, name, year, numParts, imageUrl, inventoryId }) => [
    setNumber,
    name,
    year,
    numParts,
    imageUrl,
    inventoryId
  ]);
}

export async function findSqlBuildableSets(limit = 50, runtime = globalThis) {
  const sets = await invoke("find_buildable_set_records", { limit }, runtime);
  return sets.map(({ setNumber, name, year, numParts, imageUrl, inventoryId }) => [
    setNumber,
    name,
    year,
    numParts,
    imageUrl,
    inventoryId
  ]);
}

export async function loadSqlSetParts(inventoryId, runtime = globalThis) {
  const parts = await invoke("load_sql_set_parts", { inventoryId: Number(inventoryId) }, runtime);
  return parts.map(({ partNumber, color, quantity }) => [
    partNumber,
    color,
    Number(quantity)
  ]);
}

export async function findSqlCatalogPhoto(partNumber, colorId, runtime = globalThis) {
  return invoke("find_sql_catalog_photo", {
    partNumber,
    color: String(colorId)
  }, runtime);
}
