CREATE TABLE IF NOT EXISTS inventory_items (
  id VARCHAR(120) PRIMARY KEY,
  name VARCHAR(255) NOT NULL,
  part_number VARCHAR(80) NOT NULL,
  category VARCHAR(80) NOT NULL,
  color VARCHAR(40) NOT NULL,
  quantity INT NOT NULL CHECK (quantity >= 0),
  location VARCHAR(255) NULL,
  year INT NULL,
  notes TEXT NULL,
  image LONGTEXT NULL,
  catalog_image TEXT NULL,
  catalog_source_category VARCHAR(255) NULL,
  catalog_material VARCHAR(255) NULL,
  created_at VARCHAR(40) NULL,
  updated_at VARCHAR(40) NULL,
  INDEX idx_inventory_identity (part_number, color),
  INDEX idx_inventory_search (name(120), part_number(40))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS colors (
  id VARCHAR(40) PRIMARY KEY,
  name VARCHAR(255) NOT NULL,
  hex VARCHAR(16) NOT NULL,
  transparent TINYINT(1) NOT NULL DEFAULT 0,
  part_count INT NOT NULL DEFAULT 0
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS parts (
  part_number VARCHAR(80) PRIMARY KEY,
  name VARCHAR(255) NOT NULL,
  category VARCHAR(80) NOT NULL,
  source_category VARCHAR(255) NOT NULL,
  material VARCHAR(255) NOT NULL,
  INDEX idx_parts_number (part_number)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS sets (
  set_number VARCHAR(80) PRIMARY KEY,
  name VARCHAR(255) NOT NULL,
  year INT NULL,
  num_parts INT NULL,
  image_url TEXT NULL,
  inventory_id INT NOT NULL UNIQUE,
  INDEX idx_sets_search (set_number, name(120)),
  INDEX idx_sets_num_parts (num_parts)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS set_parts (
  inventory_id INT NOT NULL,
  part_number VARCHAR(80) NOT NULL,
  color VARCHAR(40) NOT NULL,
  quantity INT NOT NULL CHECK (quantity >= 0),
  PRIMARY KEY (inventory_id, part_number, color),
  INDEX idx_set_parts_inventory (inventory_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS catalog_photos (
  part_number VARCHAR(80) NOT NULL,
  color VARCHAR(40) NOT NULL,
  image_url TEXT NOT NULL,
  PRIMARY KEY (part_number, color)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
