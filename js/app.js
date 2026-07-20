import { translate } from "./i18n.js?v=1.0b-grouped-colors";
import { parseCsvRows } from "./csv.js?v=1.0b-grouped-colors";
import {
  canonicalColorId,
  groupInventoryByPartNumber,
  LEGACY_COLOR_IDS,
  normalizePartNumber,
  upsertInventoryRecord
} from "./inventory.js?v=1.0b-grouped-colors";
import {
  getFilePermission,
  isTauriRuntime,
  loadStoredFileHandle,
  pickInventoryFile,
  readInventoryFile,
  storeFileHandle,
  supportsFileStorage,
  writeInventoryFile
} from "./file-storage.js?v=1.0b-grouped-colors";
import {
  CURRENT_SCHEMA_VERSION,
  loadStoredInventory,
  migrateInventory,
  requestPersistentStorage,
  saveInventory,
  serializeInventory
} from "./storage.js?v=1.0b-grouped-colors";
import {
  configureMysqlDatabase,
  getMysqlStatus,
  loadMysqlInventory,
  replaceMysqlInventory
} from "./mysql-storage.js?v=1.0b-grouped-colors";
import {
  loadSqlColors,
  loadSqlInventory,
  replaceSqlInventory,
  searchSqlParts,
  supportsSqlStorage
} from "./sql-storage.js?v=1.0b-grouped-colors";
import { listSnapshots, saveSnapshot, takeLatestSnapshot } from "./backups.js?v=1.0b-grouped-colors";
import {
  calculateMissingParts,
  findCatalogPhoto,
  findBuildableSets,
  loadSetParts,
  searchSets
} from "./set-catalog.js?v=1.0b-grouped-colors";
import { scannerSupported, startScanner, stopScanner } from "./scanner.js?v=1.0b-grouped-colors";

const DATA_URL = "./data/bricks.json?v=1.0b-grouped-colors";
const COLORS_URL = "./data/colors.csv?v=1.0b-grouped-colors";
const CATALOG_URL = "./data/catalog";
const MAX_IMAGE_FILE_SIZE = 10 * 1024 * 1024;
const MAX_IMAGE_DIMENSION = 1200;
const IMAGE_QUALITY = 0.82;
const RENDER_BATCH_SIZE = 80;
const ALLOWED_IMAGE_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);
const SUPPORTED_LANGUAGES = ["en", "pl", "es"];
const CATEGORY_KEYS = ["bricks", "plates", "tiles", "slopes", "technic", "minifigures", "special"];
const COLOR_TRANSLATION_KEYS = Object.fromEntries(
  Object.entries(LEGACY_COLOR_IDS).map(([key, id]) => [id, key])
);
const FALLBACK_COLORS = [
  ["0", "Black", "#05131D", false, 0],
  ["15", "White", "#FFFFFF", false, 0],
  ["71", "Light Bluish Gray", "#A0A5A9", false, 0],
  ["4", "Red", "#C91A09", false, 0],
  ["14", "Yellow", "#F2CD37", false, 0],
  ["1", "Blue", "#0055BF", false, 0],
  ["19", "Tan", "#E4CD9E", false, 0],
  ["2", "Green", "#237841", false, 0],
  ["25", "Orange", "#FE8A18", false, 0]
];

/**
 * All mutable application data lives in one small state object. Rendering is
 * derived from it, which avoids synchronizing duplicate values across the DOM.
 */
const state = {
  items: [],
  language: getInitialLanguage(),
  filters: {
    search: "",
    category: "",
    color: "",
    sort: "name"
  },
  pendingDeleteId: null
};

let pendingImage = null;
let pendingCatalogImage = null;
let selectedCatalogPart = null;
let catalogRequestId = 0;
let catalogMatches = [];
let activeCatalogSuggestion = -1;
let inventoryFileHandle = null;
let filePermissionState = "unavailable";
let fileSaveQueue = Promise.resolve();
let sqlStorageEnabled = false;
let sqlSaveQueue = Promise.resolve();
let mysqlStorageEnabled = false;
let mysqlSaveQueue = Promise.resolve();
let colorRecords = FALLBACK_COLORS;
let colorById = new Map(colorRecords.map((record) => [record[0], record]));
const catalogCache = new Map();
let renderedItems = [];
let renderedItemCount = 0;
let renderObserver;
let scannerTarget;
let setRequestId = 0;

const elements = {
  grid: document.querySelector("#brick-grid"),
  cardTemplate: document.querySelector("#brick-card-template"),
  emptyState: document.querySelector("#empty-state"),
  resultsCount: document.querySelector("#results-count"),
  search: document.querySelector("#search-input"),
  categoryFilter: document.querySelector("#category-filter"),
  colorFilter: document.querySelector("#color-filter"),
  sort: document.querySelector("#sort-select"),
  clearFilters: document.querySelector("#clear-filters"),
  language: document.querySelector("#language-select"),
  addButton: document.querySelector("#add-brick-button"),
  emptyAddButton: document.querySelector("#empty-add-button"),
  importButton: document.querySelector("#import-button"),
  exportButton: document.querySelector("#export-button"),
  connectFileButton: document.querySelector("#connect-file-button"),
  databaseButton: document.querySelector("#database-button"),
  setsButton: document.querySelector("#sets-button"),
  backupsButton: document.querySelector("#backups-button"),
  undoButton: document.querySelector("#undo-button"),
  fileStatus: document.querySelector("#file-status"),
  fileInput: document.querySelector("#file-input"),
  brickDialog: document.querySelector("#brick-dialog"),
  brickForm: document.querySelector("#brick-form"),
  dialogTitle: document.querySelector("#dialog-title"),
  closeDialog: document.querySelector("#close-dialog"),
  cancelDialog: document.querySelector("#cancel-dialog"),
  saveButton: document.querySelector("#save-brick"),
  photoInput: document.querySelector("#brick-photo"),
  photoPreview: document.querySelector("#photo-preview-image"),
  photoPlaceholder: document.querySelector("#photo-preview .photo-placeholder"),
  removePhoto: document.querySelector("#remove-photo"),
  partNumber: document.querySelector("#brick-part-number"),
  catalogSuggestions: document.querySelector("#part-catalog-suggestions"),
  catalogStatus: document.querySelector("#catalog-status"),
  confirmDialog: document.querySelector("#confirm-dialog"),
  databaseDialog: document.querySelector("#database-dialog"),
  databaseForm: document.querySelector("#database-form"),
  databaseStatus: document.querySelector("#database-status"),
  databaseSave: document.querySelector("#database-save"),
  databaseHost: document.querySelector("#database-host"),
  databasePort: document.querySelector("#database-port"),
  databaseName: document.querySelector("#database-name"),
  databaseUser: document.querySelector("#database-user"),
  databasePassword: document.querySelector("#database-password"),
  databaseCreate: document.querySelector("#database-create"),
  toast: document.querySelector("#toast"),
  updateBanner: document.querySelector("#update-banner"),
  updateButton: document.querySelector("#update-button"),
  statParts: document.querySelector("#stat-parts"),
  statItems: document.querySelector("#stat-items"),
  statColors: document.querySelector("#stat-colors"),
  colorDots: document.querySelector("#color-dots")
};

Object.assign(elements, {
  brickColor: document.querySelector("#brick-color"),
  scanPartButton: document.querySelector(".scan-part-button"),
  setsDialog: document.querySelector("#sets-dialog"),
  setSearch: document.querySelector("#set-search"),
  setSearchResults: document.querySelector("#set-search-results"),
  setDetails: document.querySelector("#set-details"),
  buildableSetsButton: document.querySelector("#buildable-sets-button"),
  buildableSetsStatus: document.querySelector("#buildable-sets-status"),
  backupsDialog: document.querySelector("#backups-dialog"),
  backupsList: document.querySelector("#backups-list"),
  scannerDialog: document.querySelector("#scanner-dialog"),
  scannerVideo: document.querySelector("#scanner-video")
});

let toastTimer;
let serviceWorkerRegistration;
let reloadingForUpdate = false;

async function initialize() {
  bindEvents();
  elements.language.value = state.language;
  applyTranslations();
  await loadColorCatalog();

  const loadedFromSql = await restoreSqlDatabase();
  const loadedFromMysql = loadedFromSql ? false : await restoreMysqlDatabase();
  const loadedFromFile = loadedFromSql || loadedFromMysql ? true : await restoreConnectedFile();
  if (!loadedFromFile) {
    const storedItems = loadStoredInventory();
    if (storedItems !== null) {
      state.items = storedItems;
    } else {
      try {
        const response = await fetch(DATA_URL);
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const data = migrateInventory(await response.json());
        state.items = data.items;
        saveInventory(state.items);
      } catch (error) {
        console.error("Starter inventory loading failed:", error);
        showToast(t("loadError"));
      }
    }
  }
  if (sqlStorageEnabled && !loadedFromSql) {
    queueSqlSave(state.items);
  } else if (mysqlStorageEnabled && !loadedFromMysql) {
    queueMysqlSave(state.items);
  }

  updateFileStorageUi();
  rebuildFilterOptions();
  render();
  registerServiceWorker();
  requestPersistentStorage().catch(() => false);
}

async function loadColorCatalog() {
  if (supportsSqlStorage()) {
    try {
      const colors = await loadSqlColors();
      if (colors.length) {
        colorRecords = colors;
        colorById = new Map(colorRecords.map((record) => [String(record[0]), record]));
        return;
      }
    } catch (error) {
      console.error("SQLite color catalog loading failed:", error);
    }
  }

  try {
    const response = await fetch(COLORS_URL);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const rows = parseCsvRows(await response.text());
    const [header, ...colors] = rows;
    if (header?.join(",") !== "id,name,hex,transparent,partCount" || !colors.length) {
      throw new Error("Invalid color catalog");
    }
    colorRecords = colors
      .map(([id, name, hex, transparent, partCount]) => [
        id,
        name,
        hex,
        transparent === "true",
        Number(partCount)
      ])
      .filter(([id, name, hex]) => id && name && hex);
    colorById = new Map(colorRecords.map((record) => [String(record[0]), record]));
  } catch (error) {
    console.error("Color catalog loading failed:", error);
  }
}

async function restoreSqlDatabase() {
  if (!supportsSqlStorage()) return false;
  sqlStorageEnabled = true;

  try {
    const items = await loadSqlInventory();
    if (!items.length) return false;
    const data = migrateInventory({
      schemaVersion: CURRENT_SCHEMA_VERSION,
      appVersion: "1.0b",
      items
    });
    state.items = data.items;
    saveLocalMirror(state.items);
    return true;
  } catch (error) {
    console.error("SQLite inventory loading failed:", error);
    sqlStorageEnabled = false;
    return false;
  }
}

async function restoreMysqlDatabase() {
  if (isTauriRuntime()) return false;

  try {
    const status = await getMysqlStatus();
    if (!status.configured || !status.connected || !status.schemaReady) {
      return false;
    }

    mysqlStorageEnabled = true;
    const items = await loadMysqlInventory();
    if (!items.length) return false;
    const data = migrateInventory({
      schemaVersion: CURRENT_SCHEMA_VERSION,
      appVersion: "1.0b",
      items
    });
    state.items = data.items;
    saveLocalMirror(state.items);
    return true;
  } catch {
    mysqlStorageEnabled = false;
    return false;
  }
}

async function restoreConnectedFile() {
  if (!supportsFileStorage()) {
    filePermissionState = "unavailable";
    return false;
  }

  try {
    inventoryFileHandle = await loadStoredFileHandle();
    if (!inventoryFileHandle) {
      filePermissionState = "disconnected";
      return false;
    }

    filePermissionState = await getFilePermission(inventoryFileHandle);
    if (filePermissionState !== "granted") return false;

    const source = await readInventoryFile(inventoryFileHandle);
    const data = migrateInventory(source);
    state.items = data.items;
    saveLocalMirror(state.items);
    if (source.schemaVersion !== CURRENT_SCHEMA_VERSION) {
      await writeInventoryFile(inventoryFileHandle, serializeInventory(state.items));
    }
    return true;
  } catch (error) {
    console.error("Connected inventory loading failed:", error);
    filePermissionState = "error";
    return false;
  }
}

async function connectInventoryFile() {
  if (!supportsFileStorage()) {
    showToast(t("fileUnsupported"));
    return;
  }

  try {
    let handle = inventoryFileHandle;
    if (!handle || filePermissionState === "granted" || filePermissionState === "error") {
      handle = await pickInventoryFile();
    }
    if (!handle) return;

    const permission = await getFilePermission(handle, true);
    if (permission !== "granted") {
      filePermissionState = permission;
      updateFileStorageUi();
      return;
    }

    const source = await readInventoryFile(handle);
    const data = migrateInventory(source);

    await storeFileHandle(handle);
    inventoryFileHandle = handle;
    filePermissionState = "granted";
    saveLocalMirror(data.items);
    if (source.schemaVersion !== CURRENT_SCHEMA_VERSION) {
      await writeInventoryFile(handle, serializeInventory(data.items));
    }
    state.items = data.items;
    clearFilters();
    updateFileStorageUi();
    rebuildFilterOptions();
    render();
    showToast(t("fileConnectedToast"));
  } catch (error) {
    if (error?.name === "AbortError") return;
    console.error("Inventory file connection failed:", error);
    updateFileStorageUi();
    showToast(t(error instanceof SyntaxError ? "invalidFile" : "fileError"));
  }
}

function bindEvents() {
  // Input events update filters immediately; rendering is cheap because cards
  // are built once in a DocumentFragment and attached in a single DOM write.
  elements.search.addEventListener("input", (event) => {
    state.filters.search = event.target.value.trim().toLocaleLowerCase(state.language);
    renderInventory();
  });

  elements.categoryFilter.addEventListener("change", (event) => {
    state.filters.category = event.target.value;
    renderInventory();
  });

  elements.colorFilter.addEventListener("change", (event) => {
    state.filters.color = event.target.value;
    renderInventory();
  });

  elements.sort.addEventListener("change", (event) => {
    state.filters.sort = event.target.value;
    renderInventory();
  });

  elements.language.addEventListener("change", (event) => {
    state.language = event.target.value;
    localStorage.setItem("brick-keeper.language", state.language);
    applyTranslations();
    rebuildFilterOptions();
    render();
  });

  elements.clearFilters.addEventListener("click", clearFilters);
  elements.addButton.addEventListener("click", () => openEditor());
  elements.emptyAddButton.addEventListener("click", () => openEditor());
  elements.closeDialog.addEventListener("click", closeEditor);
  elements.cancelDialog.addEventListener("click", closeEditor);
  elements.brickForm.addEventListener("submit", saveBrickFromForm);
  elements.photoInput.addEventListener("change", handlePhotoSelection);
  elements.removePhoto.addEventListener("click", () => setPhotoPreview(null));
  elements.partNumber.addEventListener("input", handlePartCatalogSearch);
  elements.partNumber.addEventListener("keydown", handleCatalogSuggestionKeydown);
  elements.catalogSuggestions.addEventListener("click", handleCatalogSuggestionClick);
  elements.brickColor.addEventListener("change", refreshCatalogPhoto);
  elements.grid.addEventListener("click", handleGridAction);
  elements.importButton.addEventListener("click", () => elements.fileInput.click());
  elements.fileInput.addEventListener("change", importInventory);
  elements.exportButton.addEventListener("click", exportInventory);
  elements.connectFileButton.addEventListener("click", connectInventoryFile);
  elements.databaseButton.addEventListener("click", openDatabaseDialog);
  elements.databaseForm.addEventListener("submit", saveDatabaseConfiguration);
  document.querySelectorAll(".close-database-button").forEach((button) => {
    button.addEventListener("click", () => elements.databaseDialog.close());
  });
  elements.setsButton.addEventListener("click", openSetsDialog);
  elements.buildableSetsButton.addEventListener("click", showBuildableSets);
  elements.backupsButton.addEventListener("click", openBackupsDialog);
  elements.undoButton.addEventListener("click", undoLastChange);
  elements.scanPartButton.addEventListener("click", () => openScanner(elements.partNumber));
  document.querySelector(".scan-set-button").addEventListener("click", () => openScanner(elements.setSearch));
  document.querySelector(".close-sets-button").addEventListener("click", () => elements.setsDialog.close());
  document.querySelector(".close-backups-button").addEventListener("click", () => elements.backupsDialog.close());
  document.querySelector(".close-scanner-button").addEventListener("click", closeScanner);
  elements.scannerDialog.addEventListener("close", closeScanner);
  elements.setSearch.addEventListener("input", handleSetSearch);
  elements.setSearchResults.addEventListener("click", handleSetSelection);
  elements.backupsList.addEventListener("click", restoreSelectedBackup);
  elements.confirmDialog.addEventListener("close", handleDeleteConfirmation);
  elements.updateButton.addEventListener("click", activateServiceWorkerUpdate);

  document.addEventListener("keydown", (event) => {
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "k") {
      event.preventDefault();
      elements.search.focus();
    }
  });

  document.addEventListener("pointerdown", (event) => {
    if (!event.target.closest(".part-search-control")) closeCatalogSuggestions();
  });
}

function getInitialLanguage() {
  const stored = localStorage.getItem("brick-keeper.language");
  if (SUPPORTED_LANGUAGES.includes(stored)) return stored;

  return "en";
}

function t(path, variables) {
  return translate(state.language, path, variables);
}

function applyTranslations() {
  document.documentElement.lang = state.language;
  document.querySelectorAll("[data-i18n]").forEach((node) => {
    const value = t(node.dataset.i18n);
    if (value.includes("<br>")) node.innerHTML = value;
    else node.textContent = value;
  });

  document.querySelectorAll("[data-i18n-placeholder]").forEach((node) => {
    node.placeholder = t(node.dataset.i18nPlaceholder);
  });

  elements.closeDialog.setAttribute("aria-label", t("cancel"));
  updateFileStorageUi();
}

function updateFileStorageUi() {
  if (!elements.fileStatus) return;

  const connected = filePermissionState === "granted" && inventoryFileHandle;
  elements.connectFileButton.disabled = filePermissionState === "unavailable" && !sqlStorageEnabled && !mysqlStorageEnabled;
  elements.connectFileButton.querySelector("span").textContent = t(connected ? "changeFile" : "connectFile");
  elements.fileStatus.classList.toggle("is-connected", Boolean(connected));

  if (sqlStorageEnabled) {
    elements.fileStatus.textContent = t("databaseConnected");
    elements.fileStatus.classList.add("is-connected");
  } else if (mysqlStorageEnabled) {
    elements.fileStatus.textContent = t("mysqlDatabaseConnected");
    elements.fileStatus.classList.add("is-connected");
  } else if (connected) {
    elements.fileStatus.textContent = t("fileConnected", { name: inventoryFileHandle.name });
  } else if (filePermissionState === "prompt" || filePermissionState === "denied") {
    elements.fileStatus.textContent = t("filePermissionNeeded");
  } else if (filePermissionState === "unavailable") {
    elements.fileStatus.textContent = t("fileUnsupported");
  } else if (filePermissionState === "error") {
    elements.fileStatus.textContent = t("fileError");
  } else {
    elements.fileStatus.textContent = t("fileDisconnected");
  }
}

async function openDatabaseDialog() {
  setDatabaseStatus(t("databaseChecking"));
  elements.databaseDialog.showModal();

  try {
    const status = await getMysqlStatus();
    if (status.config) {
      elements.databaseHost.value = status.config.host ?? "127.0.0.1";
      elements.databasePort.value = status.config.port ?? 3306;
      elements.databaseName.value = status.config.database ?? "brick_keeper";
      elements.databaseUser.value = status.config.username ?? "root";
    }
    setDatabaseStatus(
      status.connected && status.schemaReady
        ? t("databaseConfigured")
        : t(status.configured ? "databaseConnectionFailed" : "databaseNotConfigured"),
      status.connected && status.schemaReady ? "connected" : "error"
    );
  } catch (error) {
    console.error("MySQL status check failed:", error);
    setDatabaseStatus(t("databaseApiUnavailable"), "error");
  }
}

async function saveDatabaseConfiguration(event) {
  event.preventDefault();
  if (!elements.databaseForm.reportValidity()) return;

  const form = new FormData(elements.databaseForm);
  const config = {
    host: String(form.get("host")).trim(),
    port: Number.parseInt(form.get("port"), 10),
    database: String(form.get("database")).trim(),
    username: String(form.get("username")).trim(),
    password: String(form.get("password") ?? ""),
    createDatabase: elements.databaseCreate.checked
  };

  elements.databaseSave.disabled = true;
  setDatabaseStatus(t("databaseSaving"));
  try {
    const status = await configureMysqlDatabase(config);
    if (!status.connected || !status.schemaReady) {
      throw new Error(status.error ?? "Database schema is not ready.");
    }

    mysqlStorageEnabled = true;
    sqlStorageEnabled = false;
    const items = await loadMysqlInventory();
    if (items.length) {
      state.items = migrateInventory({
        schemaVersion: CURRENT_SCHEMA_VERSION,
        appVersion: "1.0b",
        items
      }).items;
      saveLocalMirror(state.items);
      rebuildFilterOptions();
      render();
    } else {
      queueMysqlSave(state.items);
    }
    updateFileStorageUi();
    setDatabaseStatus(t("databaseConfigured"), "connected");
    showToast(t("databaseConnectedToast"));
  } catch (error) {
    console.error("MySQL configuration failed:", error);
    setDatabaseStatus(error.message || t("databaseConnectionFailed"), "error");
    showToast(t("databaseConnectionFailed"));
  } finally {
    elements.databaseSave.disabled = false;
  }
}

function setDatabaseStatus(message, stateName = "") {
  elements.databaseStatus.textContent = message;
  elements.databaseStatus.classList.toggle("is-connected", stateName === "connected");
  elements.databaseStatus.classList.toggle("is-error", stateName === "error");
}

/**
 * Rebuilds localized select options while preserving current selections.
 * Color IDs come from the SQL catalog in Tauri or the CSV fallback on the web.
 */
function rebuildFilterOptions() {
  const categoryValue = state.filters.category;
  const colorValue = state.filters.color;
  const usedColors = [...new Set(state.items.map((item) => canonicalColorId(item.color)))]
    .sort((a, b) => getColorLabel(a).localeCompare(getColorLabel(b), state.language));

  replaceOptions(elements.categoryFilter, [
    ["", t("allCategories")],
    ...CATEGORY_KEYS.map((key) => [key, t(`categories.${key}`)])
  ]);

  replaceOptions(elements.colorFilter, [
    ["", t("allColors")],
    ...usedColors.map((id) => [id, getColorLabel(id)])
  ]);

  replaceOptions(document.querySelector("#brick-category"),
    CATEGORY_KEYS.map((key) => [key, t(`categories.${key}`)]));
  replaceOptions(document.querySelector("#brick-color"),
    colorRecords.map(([id]) => [String(id), getColorLabel(String(id))]));

  elements.categoryFilter.value = categoryValue;
  elements.colorFilter.value = colorValue;
}

function replaceOptions(select, options) {
  select.replaceChildren(...options.map(([value, label]) => new Option(label, value)));
}

function render() {
  renderStats();
  renderInventory();
}

function renderStats() {
  const totalQuantity = state.items.reduce((sum, item) => sum + item.quantity, 0);
  const colors = [...new Set(state.items.map((item) => canonicalColorId(item.color)))];
  const uniqueParts = new Set(state.items.map((item) => normalizePartNumber(item.partNumber)).filter(Boolean));

  elements.statParts.textContent = formatNumber(uniqueParts.size);
  elements.statItems.textContent = formatNumber(totalQuantity);
  elements.statColors.textContent = formatNumber(colors.length);
  elements.colorDots.replaceChildren(...colors.slice(0, 9).map((color) => {
    const dot = document.createElement("i");
    dot.style.background = getColorHex(color);
    return dot;
  }));
}

function getVisibleItems() {
  const { search, category, color, sort } = state.filters;
  return state.items.filter((item) => {
    const searchable = `${item.name} ${item.partNumber}`.toLocaleLowerCase(state.language);
    return (!search || searchable.includes(search)) &&
      (!category || item.category === category) &&
      (!color || canonicalColorId(item.color) === color);
  });
}

function getVisibleGroups() {
  const { sort } = state.filters;
  const groups = groupInventoryByPartNumber(getVisibleItems()).map((group) => {
    const variants = group.variants
      .slice()
      .sort((a, b) => getColorLabel(a.color).localeCompare(getColorLabel(b.color), state.language, {
        sensitivity: "base"
      }));
    const representative = variants.find((item) => item.image || item.catalogImage) ?? variants[0];
    const latest = variants.reduce((date, item) => (
      Math.max(date, new Date(item.updatedAt ?? item.createdAt ?? 0).getTime())
    ), 0);

    return {
      ...group,
      variants,
      representative,
      latest
    };
  });

  // Sort a grouped copy, never state.items, so saved insertion order and
  // mutation semantics remain stable.
  return groups.sort((a, b) => {
    if (sort === "quantity-desc") return b.quantity - a.quantity;
    if (sort === "recent") return b.latest - a.latest;
    return a.representative.name.localeCompare(b.representative.name, state.language, { sensitivity: "base" });
  });
}

function renderInventory() {
  renderedItems = getVisibleGroups();
  renderedItemCount = 0;
  renderObserver?.disconnect();
  elements.grid.replaceChildren();
  appendInventoryBatch();
  elements.grid.hidden = renderedItems.length === 0;
  elements.emptyState.hidden = renderedItems.length > 0;
  elements.resultsCount.textContent = t("results", {
    visible: formatNumber(renderedItems.length),
    total: formatNumber(groupInventoryByPartNumber(state.items).length)
  });
  elements.clearFilters.hidden = !Object.values(state.filters).some((value) => (
    value && value !== "name"
  ));
}

/**
 * Large result sets are rendered in bounded batches. IntersectionObserver adds
 * the next window only when the user approaches the end of the current one,
 * keeping startup DOM, layout and paint costs independent of collection size.
 */
function appendInventoryBatch() {
  const nextItems = renderedItems.slice(renderedItemCount, renderedItemCount + RENDER_BATCH_SIZE);
  const fragment = document.createDocumentFragment();
  nextItems.forEach((group) => fragment.append(createBrickGroupCard(group)));
  renderedItemCount += nextItems.length;

  const sentinel = document.createElement("div");
  sentinel.className = "virtual-sentinel";
  fragment.append(sentinel);
  elements.grid.querySelector(".virtual-sentinel")?.remove();
  elements.grid.append(fragment);

  if (renderedItemCount >= renderedItems.length) return;
  renderObserver?.disconnect();
  renderObserver = new IntersectionObserver(([entry]) => {
    if (entry.isIntersecting) appendInventoryBatch();
  }, { rootMargin: "500px" });
  renderObserver.observe(sentinel);
}

function createBrickCard(item) {
  const card = elements.cardTemplate.content.firstElementChild.cloneNode(true);
  const color = getColorHex(item.color);
  const photo = card.querySelector(".brick-photo");
  const model = card.querySelector(".brick-model");

  card.dataset.id = item.id;
  card.querySelector(".category-badge").textContent = t(`categories.${item.category}`);
  model.style.setProperty("--brick-color", color);
  const image = item.image || item.catalogImage;
  if (image) {
    photo.src = image;
    photo.alt = item.name;
    photo.hidden = false;
    model.hidden = true;
  }
  card.querySelector(".part-number").textContent = `# ${item.partNumber}`;
  card.querySelector("h3").textContent = item.name;
  card.querySelector(".color-label").style.setProperty("--dot-color", color);
  card.querySelector(".color-label b").textContent = getColorLabel(item.color);
  card.querySelector(".location-label").textContent = item.location || "—";
  card.querySelector(".quantity").textContent = formatNumber(item.quantity);
  card.querySelector(".edit-button").title = t("edit");
  card.querySelector(".copy-button").title = t("copyBrick");
  card.querySelector(".delete-button").title = t("delete");
  card.querySelector(".decrease-button").setAttribute("aria-label", t("decreaseQuantity"));
  card.querySelector(".increase-button").setAttribute("aria-label", t("increaseQuantity"));
  card.querySelectorAll("[data-i18n]").forEach((node) => {
    node.textContent = t(node.dataset.i18n);
  });

  return card;
}

function createBrickGroupCard(group) {
  const card = elements.cardTemplate.content.firstElementChild.cloneNode(true);
  const item = group.representative;
  const color = getColorHex(item.color);
  const photo = card.querySelector(".brick-photo");
  const model = card.querySelector(".brick-model");

  card.dataset.id = item.id;
  card.dataset.group = group.key;
  card.dataset.variantCount = String(group.variants.length);
  card.dataset.expanded = "false";
  card.setAttribute("aria-expanded", "false");
  card.classList.toggle("is-grouped", group.variants.length > 1);
  card.querySelector(".category-badge").textContent = t(`categories.${item.category}`);
  model.style.setProperty("--brick-color", color);
  const image = item.image || item.catalogImage;
  if (image) {
    photo.src = image;
    photo.alt = item.name;
    photo.hidden = false;
    model.hidden = true;
  }
  card.querySelector(".part-number").textContent = `# ${group.partNumber}`;
  card.querySelector("h3").textContent = item.name;
  card.querySelector(".color-label").style.setProperty("--dot-color", color);
  card.querySelector(".color-label b").textContent = group.colorCount > 1
    ? t("colorVariants", { count: formatNumber(group.colorCount) })
    : getColorLabel(item.color);
  card.querySelector(".location-label").textContent = group.variants.length > 1
    ? t("partVariants", { count: formatNumber(group.variants.length) })
    : item.location || "-";
  card.querySelector(".quantity").textContent = formatNumber(group.quantity);
  card.querySelector(".edit-button").title = t("edit");
  card.querySelector(".copy-button").title = t("copyBrick");
  card.querySelector(".delete-button").title = t("delete");
  card.querySelector(".decrease-button").setAttribute("aria-label", t("decreaseQuantity"));
  card.querySelector(".increase-button").setAttribute("aria-label", t("increaseQuantity"));
  card.querySelector(".variant-toggle").textContent = t("showColors", {
    count: formatNumber(group.colorCount)
  });
  renderVariantList(card.querySelector(".variant-list"), group.variants);
  card.querySelectorAll("[data-i18n]").forEach((node) => {
    node.textContent = t(node.dataset.i18n);
  });

  return card;
}

function renderVariantList(container, variants) {
  container.replaceChildren(...variants.map((item) => {
    const row = document.createElement("div");
    const color = document.createElement("span");
    const label = document.createElement("span");
    const quantity = document.createElement("strong");
    const actions = document.createElement("div");

    row.className = "variant-row";
    row.dataset.id = item.id;
    color.className = "variant-color";
    color.style.background = getColorHex(item.color);
    label.textContent = getColorLabel(item.color);
    quantity.textContent = t("variantQuantity", { quantity: formatNumber(item.quantity) });
    actions.className = "variant-actions";
    actions.append(
      createVariantButton("edit", t("edit")),
      createVariantButton("copy", t("copyBrick")),
      createVariantButton("decrease", "-", t("decreaseQuantity")),
      createVariantButton("increase", "+", t("increaseQuantity")),
      createVariantButton("delete", t("delete"))
    );
    row.append(color, label, quantity, actions);
    return row;
  }));
}

function createVariantButton(action, label, title = label) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "variant-action";
  button.dataset.variantAction = action;
  button.textContent = label;
  button.title = title;
  button.setAttribute("aria-label", title);
  return button;
}

function handleGridAction(event) {
  const button = event.target.closest("button");
  const card = event.target.closest(".brick-card");
  if (!card) return;

  if (!button) {
    if (!event.target.closest(".variant-list")) toggleVariantList(card);
    return;
  }

  if (button.classList.contains("variant-toggle")) {
    toggleVariantList(card);
    return;
  }

  if (button.dataset.variantAction) {
    handleVariantAction(button);
    return;
  }

  const item = state.items.find((candidate) => candidate.id === card.dataset.id);
  if (!item) return;

  if (button.classList.contains("edit-button")) {
    openEditor(item);
    return;
  }
  if (button.classList.contains("copy-button")) {
    openEditor({ ...item, id: "", quantity: 1 }, { copy: true });
    return;
  }
  if (button.classList.contains("delete-button")) {
    requestDelete(item.id);
    return;
  }
  if (button.classList.contains("increase-button")) updateQuantity(item, 1);
  if (button.classList.contains("decrease-button")) updateQuantity(item, -1);
}

function toggleVariantList(card) {
  const list = card.querySelector(".variant-list");
  const toggle = card.querySelector(".variant-toggle");
  const expanded = card.dataset.expanded === "true";
  const nextExpanded = !expanded;

  card.dataset.expanded = String(nextExpanded);
  card.setAttribute("aria-expanded", String(nextExpanded));
  toggle.setAttribute("aria-expanded", String(nextExpanded));
  toggle.textContent = t(nextExpanded ? "hideColors" : "showColors", {
    count: formatNumber(Number(card.dataset.variantCount) || 0)
  });
  list.hidden = !nextExpanded;
}

function handleVariantAction(button) {
  const row = button.closest(".variant-row");
  const item = state.items.find((candidate) => candidate.id === row?.dataset.id);
  if (!item) return;

  if (button.dataset.variantAction === "edit") {
    openEditor(item);
  } else if (button.dataset.variantAction === "copy") {
    openEditor({ ...item, id: "", quantity: 1 }, { copy: true });
  } else if (button.dataset.variantAction === "delete") {
    requestDelete(item.id);
  } else if (button.dataset.variantAction === "increase") {
    updateQuantity(item, 1);
  } else if (button.dataset.variantAction === "decrease") {
    updateQuantity(item, -1);
  }
}

function updateQuantity(item, delta) {
  const nextItems = state.items.map((candidate) => candidate.id === item.id ? {
    ...candidate,
    quantity: Math.max(0, candidate.quantity + delta),
    updatedAt: new Date().toISOString()
  } : candidate);
  commitItems(nextItems);
}

function openEditor(item = null, options = {}) {
  const isCopy = Boolean(options.copy);
  elements.brickForm.reset();
  closeCatalogSuggestions();
  setPhotoPreview(item?.image ?? item?.catalogImage ?? null, Boolean(item?.catalogImage && !item?.image));
  selectedCatalogPart = item?.catalog ?? null;
  setCatalogStatus(item?.catalog
    ? t("catalogMatch", {
      category: item.catalog.sourceCategory,
      material: item.catalog.material
    })
    : t("catalogHint"), Boolean(item?.catalog));
  document.querySelector("#brick-id").value = isCopy ? "" : item?.id ?? "";
  document.querySelector("#brick-quantity").value = item?.quantity ?? 1;
  document.querySelector("#brick-name").value = item?.name ?? "";
  document.querySelector("#brick-part-number").value = item?.partNumber ?? "";
  document.querySelector("#brick-category").value = item?.category ?? CATEGORY_KEYS[0];
  document.querySelector("#brick-color").value = item
    ? canonicalColorId(item.color)
    : colorRecords[0][0];
  document.querySelector("#brick-location").value = item?.location ?? "";
  document.querySelector("#brick-year").value = item?.year ?? "";
  document.querySelector("#brick-notes").value = item?.notes ?? "";
  elements.dialogTitle.textContent = t(isCopy ? "copyBrickTitle" : item ? "editBrick" : "newBrick");
  elements.brickDialog.showModal();
  document.querySelector("#brick-name").focus();
}

function closeEditor() {
  closeCatalogSuggestions();
  elements.brickDialog.close();
  elements.photoInput.value = "";
}

function saveBrickFromForm(event) {
  event.preventDefault();
  if (!elements.brickForm.reportValidity()) return;

  const data = new FormData(elements.brickForm);
  const id = String(data.get("id"));
  const existing = state.items.find((item) => item.id === id);
  const timestamp = new Date().toISOString();
  const record = {
    id: existing?.id ?? createId(),
    name: String(data.get("name")).trim(),
    partNumber: String(data.get("partNumber")).trim(),
    category: String(data.get("category")),
    color: canonicalColorId(String(data.get("color"))),
    quantity: Number.parseInt(data.get("quantity"), 10),
    location: String(data.get("location")).trim(),
    year: data.get("year") ? Number.parseInt(data.get("year"), 10) : null,
    notes: String(data.get("notes")).trim(),
    image: pendingImage,
    catalogImage: pendingCatalogImage,
    catalog: selectedCatalogPart,
    createdAt: existing?.createdAt ?? timestamp,
    updatedAt: timestamp
  };

  const result = upsertInventoryRecord(state.items, record, existing?.id ?? null);

  if (!commitItems(result.items)) return;
  closeEditor();
  showToast(t(result.merged ? "duplicateMerged" : "saved"));
}

function getColorRecord(value) {
  return colorById.get(canonicalColorId(value));
}

function getColorHex(value) {
  return getColorRecord(value)?.[2] ?? "#999999";
}

function getColorLabel(value) {
  const id = canonicalColorId(value);
  const translationKey = COLOR_TRANSLATION_KEYS[id];
  return translationKey ? t(`colorNames.${translationKey}`) : (getColorRecord(id)?.[1] ?? id);
}

async function handlePartCatalogSearch(event) {
  const query = event.target.value.trim().toLowerCase();
  const requestId = ++catalogRequestId;
  selectedCatalogPart = null;
  closeCatalogSuggestions();

  if (query.length < 3) {
    setCatalogStatus(t("catalogHint"));
    return;
  }

  setCatalogStatus(t("catalogSearching"));

  try {
    const records = await loadCatalogShard(query);
    if (requestId !== catalogRequestId) return;

    const matches = records
      .filter(([partNumber]) => partNumber.toLowerCase().startsWith(query))
      .slice(0, 20);

    const exact = records.find(([partNumber]) => partNumber.toLowerCase() === query);
    if (exact) {
      applyCatalogPart(exact);
    } else if (matches.length) {
      renderCatalogSuggestions(matches);
      setCatalogStatus(t("catalogSuggestions", { count: matches.length }));
    } else {
      setCatalogStatus(t("catalogNoMatch"));
    }
  } catch (error) {
    console.error("Part catalog search failed:", error);
    setCatalogStatus(t("catalogUnavailable"));
  }
}

function renderCatalogSuggestions(matches) {
  catalogMatches = matches;
  activeCatalogSuggestion = -1;
  const buttons = matches.map(([partNumber, name], index) => {
    const button = document.createElement("button");
    const number = document.createElement("strong");
    const label = document.createElement("span");

    button.type = "button";
    button.className = "catalog-suggestion";
    button.id = `catalog-suggestion-${index}`;
    button.dataset.index = String(index);
    button.tabIndex = -1;
    button.setAttribute("role", "option");
    button.setAttribute("aria-selected", "false");
    number.textContent = partNumber;
    label.textContent = name;
    button.append(number, label);
    return button;
  });

  elements.catalogSuggestions.replaceChildren(...buttons);
  elements.catalogSuggestions.hidden = false;
  elements.partNumber.setAttribute("aria-expanded", "true");
}

function closeCatalogSuggestions() {
  catalogMatches = [];
  activeCatalogSuggestion = -1;
  elements.catalogSuggestions.replaceChildren();
  elements.catalogSuggestions.hidden = true;
  elements.partNumber.setAttribute("aria-expanded", "false");
  elements.partNumber.removeAttribute("aria-activedescendant");
}

function setActiveCatalogSuggestion(index) {
  if (!catalogMatches.length) return;
  activeCatalogSuggestion = (index + catalogMatches.length) % catalogMatches.length;

  elements.catalogSuggestions.querySelectorAll(".catalog-suggestion").forEach((button, buttonIndex) => {
    const active = buttonIndex === activeCatalogSuggestion;
    button.classList.toggle("is-active", active);
    button.setAttribute("aria-selected", String(active));
    if (active) {
      elements.partNumber.setAttribute("aria-activedescendant", button.id);
      button.scrollIntoView({ block: "nearest" });
    }
  });
}

function handleCatalogSuggestionKeydown(event) {
  if (elements.catalogSuggestions.hidden) return;

  if (event.key === "ArrowDown") {
    event.preventDefault();
    setActiveCatalogSuggestion(activeCatalogSuggestion + 1);
  } else if (event.key === "ArrowUp") {
    event.preventDefault();
    setActiveCatalogSuggestion(activeCatalogSuggestion < 0
      ? catalogMatches.length - 1
      : activeCatalogSuggestion - 1);
  } else if (event.key === "Enter") {
    event.preventDefault();
    applyCatalogPart(catalogMatches[Math.max(activeCatalogSuggestion, 0)]);
  } else if (event.key === "Escape") {
    event.preventDefault();
    closeCatalogSuggestions();
  }
}

function handleCatalogSuggestionClick(event) {
  const button = event.target.closest(".catalog-suggestion");
  if (!button) return;
  const match = catalogMatches[Number.parseInt(button.dataset.index, 10)];
  if (match) applyCatalogPart(match);
}

async function loadCatalogShard(query) {
  if (supportsSqlStorage()) {
    try {
      return await searchSqlParts(query, 20);
    } catch (error) {
      console.error("SQLite part catalog search failed:", error);
    }
  }

  const shard = query.replace(/[^a-z0-9]/g, "_").padEnd(1, "_").slice(0, 1);
  if (!catalogCache.has(shard)) {
    catalogCache.set(shard, fetch(`${CATALOG_URL}/${shard}.csv?v=2026-06-10`).then(async (response) => {
      if (!response.ok) {
        if (response.status === 404) return [];
        throw new Error(`HTTP ${response.status}`);
      }
      const rows = parseCsvRows(await response.text());
      return rows.slice(1).filter(([partNumber]) => partNumber);
    }));
  }
  return catalogCache.get(shard);
}

function applyCatalogPart([partNumber, name, category, sourceCategory, material]) {
  closeCatalogSuggestions();
  elements.partNumber.value = partNumber;
  document.querySelector("#brick-name").value = name;
  document.querySelector("#brick-category").value = category;
  selectedCatalogPart = { sourceCategory, material };
  setCatalogStatus(t("catalogMatch", { category: sourceCategory, material }), true);
  refreshCatalogPhoto();
}

function setCatalogStatus(message, isMatch = false) {
  elements.catalogStatus.textContent = message;
  elements.catalogStatus.classList.toggle("is-match", isMatch);
}

/**
 * Generates a collision-resistant identifier without relying on randomUUID,
 * which is unavailable in older browsers and non-secure local contexts.
 */
function createId() {
  const randomBytes = new Uint32Array(2);
  if (globalThis.crypto?.getRandomValues) {
    globalThis.crypto.getRandomValues(randomBytes);
  } else {
    randomBytes[0] = Math.floor(Math.random() * 0xffffffff);
    randomBytes[1] = Math.floor(Math.random() * 0xffffffff);
  }

  return [
    "brick",
    Date.now().toString(36),
    randomBytes[0].toString(36),
    randomBytes[1].toString(36)
  ].join("-");
}

function setPhotoPreview(image, isCatalogImage = false) {
  pendingImage = isCatalogImage ? null : image;
  pendingCatalogImage = isCatalogImage ? image : null;
  elements.photoPreview.src = image ?? "";
  elements.photoPreview.hidden = !image;
  elements.photoPlaceholder.hidden = Boolean(image);
  elements.removePhoto.hidden = !image;
}

async function refreshCatalogPhoto() {
  if (pendingImage || !elements.partNumber.value.trim()) return;
  try {
    const image = await findCatalogPhoto(elements.partNumber.value, elements.brickColor.value);
    if (image) setPhotoPreview(image, true);
  } catch (error) {
    console.error("Catalog photo lookup failed:", error);
  }
}

async function handlePhotoSelection(event) {
  const [file] = event.target.files;
  if (!file) return;

  if (!ALLOWED_IMAGE_TYPES.has(file.type)) {
    showToast(t("invalidPhoto"));
    event.target.value = "";
    return;
  }

  if (file.size > MAX_IMAGE_FILE_SIZE) {
    showToast(t("photoTooLarge"));
    event.target.value = "";
    return;
  }

  elements.saveButton.disabled = true;
  try {
    setPhotoPreview(await compressImage(file));
  } catch (error) {
    console.error("Photo processing failed:", error);
    showToast(t("invalidPhoto"));
    event.target.value = "";
  } finally {
    elements.saveButton.disabled = false;
  }
}

/**
 * Resizes photos before they enter persistent storage or exported JSON. This keeps
 * cards quick to render and greatly reduces the chance of exceeding quota.
 */
async function compressImage(file) {
  const sourceUrl = URL.createObjectURL(file);

  try {
    const image = new Image();
    image.decoding = "async";
    image.src = sourceUrl;
    await image.decode();

    const scale = Math.min(1, MAX_IMAGE_DIMENSION / Math.max(image.width, image.height));
    const width = Math.max(1, Math.round(image.width * scale));
    const height = Math.max(1, Math.round(image.height * scale));
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext("2d");
    if (!context) throw new Error("Canvas 2D context is unavailable");
    context.drawImage(image, 0, 0, width, height);
    return canvas.toDataURL("image/webp", IMAGE_QUALITY);
  } finally {
    URL.revokeObjectURL(sourceUrl);
  }
}

function requestDelete(id) {
  state.pendingDeleteId = id;
  elements.confirmDialog.showModal();
}

function handleDeleteConfirmation() {
  if (elements.confirmDialog.returnValue === "confirm" && state.pendingDeleteId) {
    const nextItems = state.items.filter((item) => item.id !== state.pendingDeleteId);
    if (commitItems(nextItems)) showToast(t("deleted"));
  }
  state.pendingDeleteId = null;
}

function openSetsDialog() {
  setRequestId += 1;
  elements.setSearch.value = "";
  elements.setSearchResults.replaceChildren();
  setBuildableStatus(t("buildableSetsHint"));
  elements.setDetails.hidden = true;
  elements.setsDialog.showModal();
  elements.setSearch.focus();
}

async function handleSetSearch() {
  const query = elements.setSearch.value.trim();
  const requestId = ++setRequestId;
  elements.setDetails.hidden = true;
  setBuildableStatus(t("buildableSetsHint"));
  if (query.length < 2) {
    elements.setSearchResults.replaceChildren();
    return;
  }
  try {
    const matches = await searchSets(query);
    if (requestId !== setRequestId) return;
    renderSetResults(matches);
  } catch (error) {
    console.error("Set search failed:", error);
    if (requestId === setRequestId) setBuildableStatus(t("buildableSetsError"), true);
  }
}

async function showBuildableSets() {
  const requestId = ++setRequestId;
  elements.setSearch.value = "";
  elements.setSearchResults.replaceChildren();
  elements.setDetails.hidden = true;
  elements.buildableSetsButton.disabled = true;
  setBuildableStatus(t("buildableSetsChecking", {
    checked: formatNumber(0),
    total: "...",
    found: formatNumber(0)
  }));

  try {
    if (sqlStorageEnabled) await sqlSaveQueue.catch(() => undefined);
    if (mysqlStorageEnabled) await mysqlSaveQueue.catch(() => undefined);
    if (requestId !== setRequestId) return;

    const matches = await findBuildableSets(state.items, {
      limit: 50,
      useSql: sqlStorageEnabled,
      useMysql: mysqlStorageEnabled,
      onProgress: ({ checked, total, found }) => {
        if (requestId !== setRequestId) return;
        setBuildableStatus(t("buildableSetsChecking", {
          checked: formatNumber(checked),
          total: formatNumber(total),
          found: formatNumber(found)
        }));
      }
    });
    if (requestId !== setRequestId) return;

    renderSetResults(matches);
    setBuildableStatus(matches.length
      ? t("buildableSetsFound", { count: formatNumber(matches.length) })
      : t("buildableSetsEmpty"));
  } catch (error) {
    console.error("Buildable set lookup failed:", error);
    if (requestId === setRequestId) setBuildableStatus(t("buildableSetsError"), true);
  } finally {
    elements.buildableSetsButton.disabled = false;
  }
}

function renderSetResults(sets) {
  elements.setSearchResults.replaceChildren(...sets.map((set) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "set-result";
    button.dataset.set = JSON.stringify(set);
    const name = document.createElement("strong");
    name.textContent = `${set[0]} - ${set[1]}`;
    const meta = document.createElement("span");
    meta.textContent = `${set[2] ?? "-"} / ${formatNumber(set[3] ?? 0)}`;
    button.append(name, meta);
    return button;
  }));
}

function setBuildableStatus(message, isError = false) {
  elements.buildableSetsStatus.textContent = message;
  elements.buildableSetsStatus.classList.toggle("is-error", isError);
}

async function handleSetSelection(event) {
  const button = event.target.closest("[data-set]");
  if (!button) return;
  const set = JSON.parse(button.dataset.set);
  const requiredParts = await loadSetParts(set[5]);
  const normalizedInventory = state.items.map((item) => ({
    ...item,
    color: canonicalColorId(item.color)
  }));
  const missing = calculateMissingParts(requiredParts, normalizedInventory);
  const requiredTotal = requiredParts.reduce((sum, part) => sum + part[2], 0);
  const missingTotal = missing.reduce((sum, part) => sum + part.missing, 0);

  const summary = document.createElement("div");
  summary.className = "set-summary";
  const image = document.createElement("img");
  image.src = set[4];
  image.alt = set[1];
  image.loading = "lazy";
  const text = document.createElement("div");
  const title = document.createElement("h3");
  title.textContent = `${set[0]} - ${set[1]}`;
  const progress = document.createElement("p");
  progress.textContent = t("setProgress", {
    owned: formatNumber(requiredTotal - missingTotal),
    required: formatNumber(requiredTotal)
  });
  const missingTitle = document.createElement("strong");
  missingTitle.textContent = t("missingParts", { count: formatNumber(missingTotal) });
  text.append(title, progress, missingTitle);
  summary.append(image, text);

  const list = document.createElement("div");
  list.className = "missing-parts";
  missing.slice(0, 500).forEach((part) => {
    const row = document.createElement("div");
    row.className = "missing-part";
    const label = document.createElement("span");
    label.textContent = `${part.partNumber} / ${getColorLabel(part.color)}`;
    const quantity = document.createElement("strong");
    quantity.textContent = `-${formatNumber(part.missing)}`;
    row.append(label, quantity);
    list.append(row);
  });
  elements.setDetails.replaceChildren(summary, list);
  elements.setDetails.hidden = false;
}

async function openScanner(target) {
  scannerTarget = target;
  if (!scannerSupported()) {
    showToast(t("scannerUnsupported"));
    target.focus();
    return;
  }
  elements.scannerDialog.showModal();
  try {
    await startScanner(elements.scannerVideo, (value) => {
      scannerTarget.value = value;
      scannerTarget.dispatchEvent(new Event("input", { bubbles: true }));
      closeScanner();
    });
  } catch (error) {
    console.error("Scanner failed:", error);
    closeScanner();
    showToast(t("scannerUnsupported"));
  }
}

function closeScanner() {
  stopScanner(elements.scannerVideo);
  if (elements.scannerDialog.open) elements.scannerDialog.close();
}

function clearFilters() {
  state.filters = { search: "", category: "", color: "", sort: "name" };
  elements.search.value = "";
  elements.categoryFilter.value = "";
  elements.colorFilter.value = "";
  elements.sort.value = "name";
  renderInventory();
}

function commitItems(nextItems, createBackup = true) {
  const localCopySaved = saveLocalMirror(nextItems);

  if (!localCopySaved && filePermissionState !== "granted") {
    showToast(t("storageError"));
    return false;
  }

  if (createBackup) {
    saveSnapshot(state.items, "collection-change").catch((error) => {
      console.error("Snapshot saving failed:", error);
    });
  }
  state.items = nextItems;
  rebuildFilterOptions();
  render();
  queueFileSave(nextItems);
  return true;
}

async function undoLastChange() {
  try {
    const items = await takeLatestSnapshot();
    if (!items) {
      showToast(t("undoEmpty"));
      return;
    }
    commitItems(migrateInventory(items).items, false);
    showToast(t("restored"));
  } catch (error) {
    console.error("Undo failed:", error);
    showToast(t("storageError"));
  }
}

async function openBackupsDialog() {
  elements.backupsDialog.showModal();
  const snapshots = await listSnapshots();
  elements.backupsList.replaceChildren(...snapshots.map((snapshot) => {
    const row = document.createElement("div");
    row.className = "backup-row";
    const label = document.createElement("span");
    label.textContent = new Intl.DateTimeFormat(state.language, {
      dateStyle: "medium", timeStyle: "medium"
    }).format(new Date(snapshot.createdAt));
    const button = document.createElement("button");
    button.className = "button button-secondary";
    button.type = "button";
    button.dataset.snapshot = snapshot.createdAt;
    button.textContent = t("restored").replace(".", "");
    row.append(label, button);
    return row;
  }));
}

async function restoreSelectedBackup(event) {
  const button = event.target.closest("[data-snapshot]");
  if (!button) return;
  const snapshot = (await listSnapshots()).find((item) => item.createdAt === button.dataset.snapshot);
  if (!snapshot) return;
  commitItems(migrateInventory(JSON.parse(snapshot.serialized)).items);
  elements.backupsDialog.close();
  showToast(t("restored"));
}

function saveLocalMirror(items) {
  try {
    saveInventory(items);
    return true;
  } catch (error) {
    console.error("Local inventory mirror saving failed:", error);
    return false;
  }
}

function queueFileSave(items) {
  if (sqlStorageEnabled) {
    queueSqlSave(items);
    return;
  }

  if (mysqlStorageEnabled) {
    queueMysqlSave(items);
    return;
  }

  if (filePermissionState !== "granted" || !inventoryFileHandle) return;

  const handle = inventoryFileHandle;
  const contents = serializeInventory(items);
  fileSaveQueue = fileSaveQueue
    .catch(() => undefined)
    .then(() => writeInventoryFile(handle, contents))
    .catch((error) => {
      console.error("Connected inventory saving failed:", error);
      filePermissionState = "error";
      updateFileStorageUi();
      showToast(t("fileError"));
    });
}

function queueMysqlSave(items) {
  const snapshot = items.map((item) => ({ ...item }));
  mysqlSaveQueue = mysqlSaveQueue
    .catch(() => undefined)
    .then(() => replaceMysqlInventory(snapshot))
    .catch((error) => {
      console.error("MySQL inventory saving failed:", error);
      showToast(t("storageError"));
    });
}

function queueSqlSave(items) {
  const snapshot = items.map((item) => ({ ...item }));
  sqlSaveQueue = sqlSaveQueue
    .catch(() => undefined)
    .then(() => replaceSqlInventory(snapshot))
    .catch((error) => {
      console.error("SQLite inventory saving failed:", error);
      showToast(t("storageError"));
    });
}

async function importInventory(event) {
  const [file] = event.target.files;
  if (!file) return;

  try {
    const data = migrateInventory(JSON.parse(await file.text()));
    clearFilters();
    if (!commitItems(data.items)) return;
    showToast(t("imported"));
  } catch (error) {
    console.error("Inventory import failed:", error);
    showToast(t("invalidFile"));
  } finally {
    event.target.value = "";
  }
}

function exportInventory() {
  const blob = new Blob([serializeInventory(state.items)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `brick-keeper-${new Date().toISOString().slice(0, 10)}.json`;
  link.click();
  URL.revokeObjectURL(url);
  showToast(t("exported"));
}

function formatNumber(value) {
  return new Intl.NumberFormat(state.language).format(value);
}

function showToast(message) {
  clearTimeout(toastTimer);
  elements.toast.textContent = message;
  elements.toast.classList.add("is-visible");
  toastTimer = setTimeout(() => elements.toast.classList.remove("is-visible"), 2600);
}

async function registerServiceWorker() {
  if (isTauriRuntime() || !("serviceWorker" in navigator)) return;

  navigator.serviceWorker.addEventListener("controllerchange", () => {
    if (reloadingForUpdate) return;
    reloadingForUpdate = true;
    window.location.reload();
  });

  try {
    serviceWorkerRegistration = await navigator.serviceWorker.register(
      "./service-worker.js?v=1.0b-grouped-colors",
      { updateViaCache: "none" }
    );

    if (serviceWorkerRegistration.waiting && navigator.serviceWorker.controller) {
      showServiceWorkerUpdate();
    }

    serviceWorkerRegistration.addEventListener("updatefound", () => {
      const worker = serviceWorkerRegistration.installing;
      if (!worker) return;
      worker.addEventListener("statechange", () => {
        if (worker.state === "installed" && navigator.serviceWorker.controller) {
          showServiceWorkerUpdate();
        }
      });
    });
  } catch (error) {
    console.error("Service worker registration failed:", error);
  }
}

function showServiceWorkerUpdate() {
  elements.updateBanner.hidden = false;
}

function activateServiceWorkerUpdate() {
  if (!serviceWorkerRegistration?.waiting) return;
  elements.updateButton.disabled = true;
  serviceWorkerRegistration.waiting.postMessage({ type: "SKIP_WAITING" });
}

initialize();
