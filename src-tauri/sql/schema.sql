PRAGMA foreign_keys = ON;
PRAGMA journal_mode = WAL;

CREATE TABLE IF NOT EXISTS schema_migrations (
  version INTEGER PRIMARY KEY,
  applied_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS reference_meta (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS inventory_items (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  part_number TEXT NOT NULL,
  category TEXT NOT NULL,
  color TEXT NOT NULL,
  quantity INTEGER NOT NULL CHECK (quantity >= 0),
  location TEXT,
  year INTEGER,
  notes TEXT,
  image TEXT,
  catalog_image TEXT,
  catalog_source_category TEXT,
  catalog_material TEXT,
  created_at TEXT,
  updated_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_inventory_identity
  ON inventory_items(part_number COLLATE NOCASE, color);

CREATE INDEX IF NOT EXISTS idx_inventory_search
  ON inventory_items(name COLLATE NOCASE, part_number COLLATE NOCASE);

CREATE TABLE IF NOT EXISTS colors (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  hex TEXT NOT NULL,
  transparent INTEGER NOT NULL DEFAULT 0,
  part_count INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS parts (
  part_number TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  category TEXT NOT NULL,
  source_category TEXT NOT NULL,
  material TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_parts_number
  ON parts(part_number COLLATE NOCASE);

CREATE TABLE IF NOT EXISTS sets (
  set_number TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  year INTEGER,
  num_parts INTEGER,
  image_url TEXT,
  inventory_id INTEGER NOT NULL UNIQUE
);

CREATE INDEX IF NOT EXISTS idx_sets_search
  ON sets(set_number COLLATE NOCASE, name COLLATE NOCASE);

CREATE TABLE IF NOT EXISTS set_parts (
  inventory_id INTEGER NOT NULL,
  part_number TEXT NOT NULL,
  color TEXT NOT NULL,
  quantity INTEGER NOT NULL CHECK (quantity >= 0),
  PRIMARY KEY (inventory_id, part_number, color)
);

CREATE INDEX IF NOT EXISTS idx_set_parts_inventory
  ON set_parts(inventory_id);

CREATE TABLE IF NOT EXISTS catalog_photos (
  part_number TEXT NOT NULL,
  color TEXT NOT NULL,
  image_url TEXT NOT NULL,
  PRIMARY KEY (part_number, color)
);

INSERT OR IGNORE INTO schema_migrations(version) VALUES (1);
