import { translate } from "./i18n.js";
import {
  loadStoredInventory,
  saveInventory,
  serializeInventory,
  validateInventory
} from "./storage.js";

const DATA_URL = "./data/bricks.json";
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

  card.dataset.id = item.id;
  card.querySelector(".category-badge").textContent = t(`categories.${item.category}`);
  card.querySelector(".brick-model").style.setProperty("--brick-color", color);
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
  item.quantity = Math.max(0, item.quantity + delta);
  item.updatedAt = new Date().toISOString();
  persistAndRender();
}

function openEditor(item = null) {
  elements.brickForm.reset();
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
}

function saveBrickFromForm(event) {
  event.preventDefault();
  const data = new FormData(elements.brickForm);
  const id = String(data.get("id"));
  const existing = state.items.find((item) => item.id === id);
  const timestamp = new Date().toISOString();
  const record = {
    id: existing?.id ?? crypto.randomUUID(),
    name: String(data.get("name")).trim(),
    partNumber: String(data.get("partNumber")).trim(),
    category: String(data.get("category")),
    color: String(data.get("color")),
    quantity: Number.parseInt(data.get("quantity"), 10),
    location: String(data.get("location")).trim(),
    year: data.get("year") ? Number.parseInt(data.get("year"), 10) : null,
    notes: String(data.get("notes")).trim(),
    createdAt: existing?.createdAt ?? timestamp,
    updatedAt: timestamp
  };

  if (existing) Object.assign(existing, record);
  else state.items.push(record);

  persistAndRender();
  closeEditor();
  showToast(t("saved"));
}

function requestDelete(id) {
  state.pendingDeleteId = id;
  elements.confirmDialog.showModal();
}

function handleDeleteConfirmation() {
  if (elements.confirmDialog.returnValue === "confirm" && state.pendingDeleteId) {
    state.items = state.items.filter((item) => item.id !== state.pendingDeleteId);
    persistAndRender();
    showToast(t("deleted"));
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

function persistAndRender() {
  saveInventory(state.items);
  render();
}

async function importInventory(event) {
  const [file] = event.target.files;
  if (!file) return;

  try {
    const data = JSON.parse(await file.text());
    if (!validateInventory(data)) throw new Error("Invalid schema");
    state.items = data.items;
    clearFilters();
    persistAndRender();
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
