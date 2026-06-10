import { translate } from "./i18n.js?v=1.0b";
import {
  canonicalColorId,
  LEGACY_COLOR_IDS,
  upsertInventoryRecord
} from "./inventory.js?v=1.0b";
import {
  getFilePermission,
  loadStoredFileHandle,
  pickInventoryFile,
  readInventoryFile,
  storeFileHandle,
  supportsFileStorage,
  writeInventoryFile
} from "./file-storage.js?v=1.0b";
import {
  CURRENT_SCHEMA_VERSION,
  loadStoredInventory,
  migrateInventory,
  requestPersistentStorage,
  saveInventory,
  serializeInventory
} from "./storage.js?v=1.0b";
import { listSnapshots, saveSnapshot, takeLatestSnapshot } from "./backups.js?v=1.0b";
import {
  calculateMissingParts,
  findCatalogPhoto,
  loadSetParts,
  searchSets
} from "./set-catalog.js?v=1.0b";
import { scannerSupported, startScanner, stopScanner } from "./scanner.js?v=1.0b";

const DATA_URL = "./data/bricks.json?v=1.0b";
const COLORS_URL = "./data/colors.json?v=1.0b";
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
let inventoryFileHandle = null;
let filePermissionState = "unavailable";
let fileSaveQueue = Promise.resolve();
let colorRecords = FALLBACK_COLORS;
let colorById = new Map(colorRecords.map((record) => [record[0], record]));
const catalogCache = new Map();
let renderedItems = [];
let renderedItemCount = 0;
let renderObserver;
let scannerTarget;

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

  const loadedFromFile = await restoreConnectedFile();
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

  updateFileStorageUi();
  rebuildFilterOptions();
  render();
  registerServiceWorker();
  requestPersistentStorage().catch(() => false);
}

async function loadColorCatalog() {
  try {
    const response = await fetch(COLORS_URL);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const data = await response.json();
    if (!data || data.schemaVersion !== 1 || !Array.isArray(data.colors)) {
      throw new Error("Invalid color catalog");
    }
    colorRecords = data.colors;
    colorById = new Map(colorRecords.map((record) => [String(record[0]), record]));
  } catch (error) {
    console.error("Color catalog loading failed:", error);
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

    const permission = await getFilePermission(handle, true);
    if (permission !== "granted") {
      filePermissionState = permission;
      updateFileStorageUi();
      return;
    }

    const source = await readInventoryFile(handle);
    const data = migrateInventory(source);

    inventoryFileHandle = handle;
    filePermissionState = "granted";
    await storeFileHandle(handle);
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
  elements.brickColor.addEventListener("change", refreshCatalogPhoto);
  elements.grid.addEventListener("click", handleGridAction);
  elements.importButton.addEventListener("click", () => elements.fileInput.click());
  elements.fileInput.addEventListener("change", importInventory);
  elements.exportButton.addEventListener("click", exportInventory);
  elements.connectFileButton.addEventListener("click", connectInventoryFile);
  elements.setsButton.addEventListener("click", openSetsDialog);
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
  elements.connectFileButton.disabled = filePermissionState === "unavailable";
  elements.connectFileButton.querySelector("span").textContent = t(connected ? "changeFile" : "connectFile");
  elements.fileStatus.classList.toggle("is-connected", Boolean(connected));

  if (connected) {
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

/**
 * Rebuilds localized select options while preserving current selections.
 * Color IDs come from the CSV-derived catalog and remain language-independent.
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

  elements.statParts.textContent = formatNumber(state.items.length);
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
  const visible = state.items.filter((item) => {
    const searchable = `${item.name} ${item.partNumber}`.toLocaleLowerCase(state.language);
    return (!search || searchable.includes(search)) &&
      (!category || item.category === category) &&
      (!color || canonicalColorId(item.color) === color);
  });

  // Sort a filtered copy, never state.items, so the saved insertion order and
  // "recently added" semantics remain stable.
  return visible.sort((a, b) => {
    if (sort === "quantity-desc") return b.quantity - a.quantity;
    if (sort === "recent") return new Date(b.createdAt) - new Date(a.createdAt);
    return a.name.localeCompare(b.name, state.language, { sensitivity: "base" });
  });
}

function renderInventory() {
  renderedItems = getVisibleItems();
  renderedItemCount = 0;
  renderObserver?.disconnect();
  elements.grid.replaceChildren();
  appendInventoryBatch();
  elements.grid.hidden = renderedItems.length === 0;
  elements.emptyState.hidden = renderedItems.length > 0;
  elements.resultsCount.textContent = t("results", {
    visible: formatNumber(renderedItems.length),
    total: formatNumber(state.items.length)
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
  nextItems.forEach((item) => fragment.append(createBrickCard(item)));
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
  card.querySelector(".delete-button").title = t("delete");
  card.querySelector(".decrease-button").setAttribute("aria-label", t("decreaseQuantity"));
  card.querySelector(".increase-button").setAttribute("aria-label", t("increaseQuantity"));
  card.querySelectorAll("[data-i18n]").forEach((node) => {
    node.textContent = t(node.dataset.i18n);
  });

  return card;
}

function handleGridAction(event) {
  const button = event.target.closest("button");
  const card = event.target.closest(".brick-card");
  if (!button || !card) return;

  const item = state.items.find((candidate) => candidate.id === card.dataset.id);
  if (!item) return;

  if (button.classList.contains("edit-button")) openEditor(item);
  if (button.classList.contains("delete-button")) requestDelete(item.id);
  if (button.classList.contains("increase-button")) updateQuantity(item, 1);
  if (button.classList.contains("decrease-button")) updateQuantity(item, -1);
}

function updateQuantity(item, delta) {
  const nextItems = state.items.map((candidate) => candidate.id === item.id ? {
    ...candidate,
    quantity: Math.max(0, candidate.quantity + delta),
    updatedAt: new Date().toISOString()
  } : candidate);
  commitItems(nextItems);
}

function openEditor(item = null) {
  elements.brickForm.reset();
  setPhotoPreview(item?.image ?? item?.catalogImage ?? null, Boolean(item?.catalogImage && !item?.image));
  selectedCatalogPart = item?.catalog ?? null;
  setCatalogStatus(item?.catalog
    ? t("catalogMatch", {
      category: item.catalog.sourceCategory,
      material: item.catalog.material
    })
    : t("catalogHint"), Boolean(item?.catalog));
  document.querySelector("#brick-id").value = item?.id ?? "";
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
  elements.dialogTitle.textContent = t(item ? "editBrick" : "newBrick");
  elements.brickDialog.showModal();
  document.querySelector("#brick-name").focus();
}

function closeEditor() {
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
  elements.catalogSuggestions.replaceChildren();

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

    elements.catalogSuggestions.replaceChildren(...matches.map(([partNumber, name]) => {
      const option = document.createElement("option");
      option.value = partNumber;
      option.label = name;
      return option;
    }));

    const exact = records.find(([partNumber]) => partNumber.toLowerCase() === query);
    if (exact) {
      applyCatalogPart(exact);
    } else if (matches.length) {
      setCatalogStatus(t("catalogSuggestions", { count: matches.length }));
    } else {
      setCatalogStatus(t("catalogNoMatch"));
    }
  } catch (error) {
    console.error("Part catalog search failed:", error);
    setCatalogStatus(t("catalogUnavailable"));
  }
}

async function loadCatalogShard(query) {
  const shard = query.replace(/[^a-z0-9]/g, "_").padEnd(1, "_").slice(0, 1);
  if (!catalogCache.has(shard)) {
    catalogCache.set(shard, fetch(`${CATALOG_URL}/${shard}.json?v=2026-06-10`).then((response) => {
      if (!response.ok) {
        if (response.status === 404) return [];
        throw new Error(`HTTP ${response.status}`);
      }
      return response.json();
    }));
  }
  return catalogCache.get(shard);
}

function applyCatalogPart([partNumber, name, category, sourceCategory, material]) {
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
  elements.setSearch.value = "";
  elements.setSearchResults.replaceChildren();
  elements.setDetails.hidden = true;
  elements.setsDialog.showModal();
  elements.setSearch.focus();
}

async function handleSetSearch() {
  const query = elements.setSearch.value.trim();
  elements.setDetails.hidden = true;
  if (query.length < 2) {
    elements.setSearchResults.replaceChildren();
    return;
  }
  try {
    const matches = await searchSets(query);
    elements.setSearchResults.replaceChildren(...matches.map((set) => {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "set-result";
      button.dataset.set = JSON.stringify(set);
      const name = document.createElement("strong");
      name.textContent = `${set[0]} - ${set[1]}`;
      const meta = document.createElement("span");
      meta.textContent = `${set[2]} / ${formatNumber(set[3])}`;
      button.append(name, meta);
      return button;
    }));
  } catch (error) {
    console.error("Set search failed:", error);
  }
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
  if (!("serviceWorker" in navigator)) return;

  navigator.serviceWorker.addEventListener("controllerchange", () => {
    if (reloadingForUpdate) return;
    reloadingForUpdate = true;
    window.location.reload();
  });

  try {
    serviceWorkerRegistration = await navigator.serviceWorker.register(
      "./service-worker.js?v=1.0b",
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
