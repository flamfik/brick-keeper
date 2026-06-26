const STATUS_URL = "./api/database.php?action=status";
const CONFIGURE_URL = "./api/database.php?action=configure";
const INVENTORY_URL = "./api/inventory.php";

async function fetchJson(url, options = {}, runtime = globalThis) {
  if (typeof runtime.fetch !== "function") {
    throw new Error("Fetch API is unavailable.");
  }

  const response = await runtime.fetch(url, {
    ...options,
    headers: {
      Accept: "application/json",
      ...(options.body ? { "Content-Type": "application/json" } : {}),
      ...options.headers
    }
  });

  let payload = null;
  try {
    payload = await response.json();
  } catch (error) {
    throw new Error(`MySQL API did not return JSON (${response.status}).`);
  }

  if (!response.ok || payload?.ok === false) {
    throw new Error(payload?.error ?? `MySQL API request failed (${response.status}).`);
  }

  return payload;
}

export async function getMysqlStatus(runtime = globalThis) {
  return fetchJson(STATUS_URL, {}, runtime);
}

export async function configureMysqlDatabase(config, runtime = globalThis) {
  return fetchJson(CONFIGURE_URL, {
    method: "POST",
    body: JSON.stringify(config)
  }, runtime);
}

export async function loadMysqlInventory(runtime = globalThis) {
  const payload = await fetchJson(INVENTORY_URL, {}, runtime);
  return Array.isArray(payload.items) ? payload.items : [];
}

export async function replaceMysqlInventory(items, runtime = globalThis) {
  await fetchJson(INVENTORY_URL, {
    method: "PUT",
    body: JSON.stringify({ items })
  }, runtime);
}
