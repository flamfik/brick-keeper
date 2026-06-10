import { translate } from "./i18n.js?v=0.9.3";
import {
  loadStoredInventory,
  saveInventory,
  serializeInventory,
  validateInventory
} from "./storage.js?v=0.9.3";

const DATA_URL = "./data/bricks.json?v=0.9.3";
const CATALOG_URL = "./data/catalog";
const MAX_IMAGE_FILE_SIZE = 10 * 1024 * 1024;
const MAX_IMAGE_DIMENSION = 1200;
const IMAGE_QUALITY = 0.82;
const ALLOWED_IMAGE_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);
const SUPPORTED_LANGUAGES = ["pl", "en", "es"];
const CATEGORY_KEYS = ["bricks", "plates", "tiles", "slopes", "technic", "minifigures", "special"];
const COLOR_MAP = {
  red: "#d9272e",
  blue: "#2864cf",
  yellow: "#f2c433",
  green: "#238557",
  black: "#252827",
  white: "#f7f5ef",
  gray: "#8a918d",
  orange: "#e97825",
  tan: "#c5ab79"
};

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
let selectedCatalogPart = null;
let catalogRequestId = 0;
const catalogCache = new Map();

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
  statParts: document.querySelector("#stat-parts"),
  statItems: document.querySelector("#stat-items"),
  statColors: document.querySelector("#stat-colors"),
  colorDots: document.querySelector("#color-dots")
};

let toastTimer;

async function initialize() {
  bindEvents();
  elements.language.value = state.language;
  applyTranslations();

  const storedItems = loadStoredInventory();
  if (storedItems !== null) {
    state.items = storedItems;
  } else {
    try {
      const response = await fetch(DATA_URL);
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const data = await response.json();
      if (!validateInventory(data)) throw new Error("Invalid starter data");
      state.items = data.items;
      saveInventory(state.items);
    } catch (error) {
      console.error("Starter inventory loading failed:", error);
      showToast(t("loadError"));
    }
  }

  rebuildFilterOptions();
  render();
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
  elements.grid.addEventListener("click", handleGridAction);
  elements.importButton.addEventListener("click", () => elements.fileInput.click());
  elements.fileInput.addEventListener("change", importInventory);
  elements.exportButton.addEventListener("click", exportInventory);
  elements.confirmDialog.addEventListener("close", handleDeleteConfirmation);

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

  const browserLanguage = navigator.language.slice(0, 2);
  return SUPPORTED_LANGUAGES.includes(browserLanguage) ? browserLanguage : "pl";
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
}

/**
 * Rebuilds localized select options while preserving current selections.
 * Categories and colors are sourced from stable keys rather than display text.
 */
function rebuildFilterOptions() {
  const categoryValue = state.filters.category;
  const colorValue = state.filters.color;

  replaceOptions(elements.categoryFilter, [
    ["", t("allCategories")],
    ...CATEGORY_KEYS.map((key) => [key, t(`categories.${key}`)])
  ]);

  replaceOptions(elements.colorFilter, [
    ["", t("allColors")],
    ...Object.keys(COLOR_MAP).map((key) => [key, t(`colorNames.${key}`)])
  ]);

  replaceOptions(document.querySelector("#brick-category"),
    CATEGORY_KEYS.map((key) => [key, t(`categories.${key}`)]));
  replaceOptions(document.querySelector("#brick-color"),
    Object.keys(COLOR_MAP).map((key) => [key, t(`colorNames.${key}`)]));

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
  const colors = [...new Set(state.items.map((item) => item.color))];

  elements.statParts.textContent = formatNumber(state.items.length);
  elements.statItems.textContent = formatNumber(totalQuantity);
  elements.statColors.textContent = formatNumber(colors.length);
  elements.colorDots.replaceChildren(...colors.slice(0, 9).map((color) => {
    const dot = document.createElement("i");
    dot.style.background = COLOR_MAP[color] ?? "#999";
    return dot;
  }));
}

function getVisibleItems() {
  const { search, category, color, sort } = state.filters;
  const visible = state.items.filter((item) => {
    const searchable = `${item.name} ${item.partNumber}`.toLocaleLowerCase(state.language);
    return (!search || searchable.includes(search)) &&
      (!category || item.category === category) &&
      (!color || item.color === color);
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
  const visibleItems = getVisibleItems();
  const fragment = document.createDocumentFragment();

  visibleItems.forEach((item) => fragment.append(createBrickCard(item)));
  elements.grid.replaceChildren(fragment);
  elements.grid.hidden = visibleItems.length === 0;
  elements.emptyState.hidden = visibleItems.length > 0;
  elements.resultsCount.textContent = t("results", {
    visible: formatNumber(visibleItems.length),
    total: formatNumber(state.items.length)
  });
  elements.clearFilters.hidden = !Object.values(state.filters).some((value) => (
    value && value !== "name"
  ));
}

function createBrickCard(item) {
  const card = elements.cardTemplate.content.firstElementChild.cloneNode(true);
  const color = COLOR_MAP[item.color] ?? "#999";
  const photo = card.querySelector(".brick-photo");
  const model = card.querySelector(".brick-model");

  card.dataset.id = item.id;
  card.querySelector(".category-badge").textContent = t(`categories.${item.category}`);
  model.style.setProperty("--brick-color", color);
  if (item.image) {
    photo.src = item.image;
    photo.alt = item.name;
    photo.hidden = false;
    model.hidden = true;
  }
  card.querySelector(".part-number").textContent = `# ${item.partNumber}`;
  card.querySelector("h3").textContent = item.name;
  card.querySelector(".color-label").style.setProperty("--dot-color", color);
  card.querySelector(".color-label b").textContent = t(`colorNames.${item.color}`);
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
  setPhotoPreview(item?.image ?? null);
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
  document.querySelector("#brick-color").value = item?.color ?? Object.keys(COLOR_MAP)[0];
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
    color: String(data.get("color")),
    quantity: Number.parseInt(data.get("quantity"), 10),
    location: String(data.get("location")).trim(),
    year: data.get("year") ? Number.parseInt(data.get("year"), 10) : null,
    notes: String(data.get("notes")).trim(),
    image: pendingImage,
    catalog: selectedCatalogPart,
    createdAt: existing?.createdAt ?? timestamp,
    updatedAt: timestamp
  };

  const nextItems = existing
    ? state.items.map((item) => item.id === existing.id ? record : item)
    : [...state.items, record];

  if (!commitItems(nextItems)) return;
  closeEditor();
  showToast(t("saved"));
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
  const shard = query.replace(/[^a-z0-9]/g, "_").padEnd(3, "_").slice(0, 3);
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

function setPhotoPreview(image) {
  pendingImage = image;
  elements.photoPreview.src = image ?? "";
  elements.photoPreview.hidden = !image;
  elements.photoPlaceholder.hidden = Boolean(image);
  elements.removePhoto.hidden = !image;
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
 * Resizes photos before they enter localStorage or exported JSON. This keeps
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

function clearFilters() {
  state.filters = { search: "", category: "", color: "", sort: "name" };
  elements.search.value = "";
  elements.categoryFilter.value = "";
  elements.colorFilter.value = "";
  elements.sort.value = "name";
  renderInventory();
}

function commitItems(nextItems) {
  try {
    saveInventory(nextItems);
  } catch (error) {
    console.error("Inventory saving failed:", error);
    showToast(t("storageError"));
    return false;
  }

  state.items = nextItems;
  render();
  return true;
}

async function importInventory(event) {
  const [file] = event.target.files;
  if (!file) return;

  try {
    const data = JSON.parse(await file.text());
    if (!validateInventory(data)) throw new Error("Invalid schema");
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

initialize();
