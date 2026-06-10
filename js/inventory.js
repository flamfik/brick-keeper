export const LEGACY_COLOR_IDS = {
  black: "0",
  blue: "1",
  green: "2",
  red: "4",
  yellow: "14",
  white: "15",
  tan: "19",
  orange: "25",
  gray: "71"
};

export function canonicalColorId(value) {
  const normalized = String(value);
  return LEGACY_COLOR_IDS[normalized] ?? normalized;
}

export function normalizePartNumber(value) {
  return String(value).trim().toLocaleLowerCase("en");
}

export function upsertInventoryRecord(items, record, existingId = null) {
  const duplicate = items.find((item) => (
    item.id !== existingId &&
    normalizePartNumber(item.partNumber) === normalizePartNumber(record.partNumber) &&
    canonicalColorId(item.color) === canonicalColorId(record.color)
  ));

  if (!duplicate) {
    return {
      merged: false,
      items: existingId
        ? items.map((item) => item.id === existingId ? record : item)
        : [...items, record]
    };
  }

  const mergedRecord = {
    ...duplicate,
    name: record.name || duplicate.name,
    partNumber: record.partNumber,
    category: record.category,
    color: canonicalColorId(record.color),
    quantity: duplicate.quantity + record.quantity,
    location: record.location || duplicate.location,
    year: record.year ?? duplicate.year,
    notes: record.notes || duplicate.notes,
    image: record.image ?? duplicate.image,
    catalogImage: record.catalogImage ?? duplicate.catalogImage,
    catalog: record.catalog ?? duplicate.catalog,
    updatedAt: record.updatedAt
  };

  return {
    merged: true,
    items: items
      .filter((item) => item.id !== existingId)
      .map((item) => item.id === duplicate.id ? mergedRecord : item)
  };
}
