use rusqlite::{params, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use tauri::{Manager, State};

const REFERENCE_VERSION: &str = "2026-06-25-sql-reference-v1";

pub struct DatabaseState {
    pub path: PathBuf,
    pub connection: Mutex<Connection>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DatabaseStatus {
    pub path: String,
    pub inventory_items: i64,
    pub parts: i64,
    pub sets: i64,
    pub colors: i64,
    pub reference_version: Option<String>,
}

#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CatalogInfo {
    pub source_category: String,
    pub material: String,
}

#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct InventoryItem {
    pub id: String,
    pub name: String,
    pub part_number: String,
    pub category: String,
    pub color: String,
    pub quantity: i64,
    pub location: Option<String>,
    pub year: Option<i64>,
    pub notes: Option<String>,
    pub image: Option<String>,
    pub catalog_image: Option<String>,
    pub catalog: Option<CatalogInfo>,
    pub created_at: Option<String>,
    pub updated_at: Option<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ColorRecord {
    pub id: String,
    pub name: String,
    pub hex: String,
    pub transparent: bool,
    pub part_count: i64,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PartRecord {
    pub part_number: String,
    pub name: String,
    pub category: String,
    pub source_category: String,
    pub material: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SetRecord {
    pub set_number: String,
    pub name: String,
    pub year: Option<i64>,
    pub num_parts: Option<i64>,
    pub image_url: Option<String>,
    pub inventory_id: i64,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SetPartRecord {
    pub part_number: String,
    pub color: String,
    pub quantity: i64,
}

pub fn initialize_database(app: &tauri::AppHandle) -> Result<DatabaseState, String> {
    let directory = app.path().app_data_dir().map_err(|error| error.to_string())?;
    std::fs::create_dir_all(&directory).map_err(|error| error.to_string())?;
    let path = directory.join("brick-keeper.sqlite3");
    let mut connection = Connection::open(&path).map_err(|error| error.to_string())?;
    connection
        .execute_batch(include_str!("../sql/schema.sql"))
        .map_err(|error| error.to_string())?;
    import_reference_data(&mut connection, app)?;
    Ok(DatabaseState {
        path,
        connection: Mutex::new(connection),
    })
}

#[tauri::command]
pub fn database_status(state: State<'_, DatabaseState>) -> Result<DatabaseStatus, String> {
    let connection = state
        .connection
        .lock()
        .map_err(|_| "The database connection is unavailable.".to_string())?;
    let inventory_items = connection
        .query_row("SELECT COUNT(*) FROM inventory_items", [], |row| row.get(0))
        .map_err(|error| error.to_string())?;
    let parts = connection
        .query_row("SELECT COUNT(*) FROM parts", [], |row| row.get(0))
        .map_err(|error| error.to_string())?;
    let sets = connection
        .query_row("SELECT COUNT(*) FROM sets", [], |row| row.get(0))
        .map_err(|error| error.to_string())?;
    let colors = connection
        .query_row("SELECT COUNT(*) FROM colors", [], |row| row.get(0))
        .map_err(|error| error.to_string())?;
    let reference_version = connection
        .query_row(
            "SELECT value FROM reference_meta WHERE key = 'referenceVersion'",
            [],
            |row| row.get(0),
        )
        .optional()
        .map_err(|error| error.to_string())?;
    Ok(DatabaseStatus {
        path: state.path.to_string_lossy().into_owned(),
        inventory_items,
        parts,
        sets,
        colors,
        reference_version,
    })
}

#[tauri::command]
pub fn load_inventory_items(state: State<'_, DatabaseState>) -> Result<Vec<InventoryItem>, String> {
    let connection = state
        .connection
        .lock()
        .map_err(|_| "The database connection is unavailable.".to_string())?;
    let mut statement = connection
        .prepare(
            "SELECT id, name, part_number, category, color, quantity, location, year, notes,
                    image, catalog_image, catalog_source_category, catalog_material,
                    created_at, updated_at
             FROM inventory_items
             ORDER BY updated_at DESC, name COLLATE NOCASE ASC",
        )
        .map_err(|error| error.to_string())?;
    let items = statement
        .query_map([], |row| {
            let source_category: Option<String> = row.get(11)?;
            let material: Option<String> = row.get(12)?;
            Ok(InventoryItem {
                id: row.get(0)?,
                name: row.get(1)?,
                part_number: row.get(2)?,
                category: row.get(3)?,
                color: row.get(4)?,
                quantity: row.get(5)?,
                location: row.get(6)?,
                year: row.get(7)?,
                notes: row.get(8)?,
                image: row.get(9)?,
                catalog_image: row.get(10)?,
                catalog: source_category.zip(material).map(|(source_category, material)| CatalogInfo {
                    source_category,
                    material,
                }),
                created_at: row.get(13)?,
                updated_at: row.get(14)?,
            })
        })
        .map_err(|error| error.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|error| error.to_string())?;
    Ok(items)
}

#[tauri::command]
pub fn replace_inventory_items(
    state: State<'_, DatabaseState>,
    items: Vec<InventoryItem>,
) -> Result<(), String> {
    let mut connection = state
        .connection
        .lock()
        .map_err(|_| "The database connection is unavailable.".to_string())?;
    let transaction = connection.transaction().map_err(|error| error.to_string())?;
    transaction
        .execute("DELETE FROM inventory_items", [])
        .map_err(|error| error.to_string())?;

    {
        let mut insert = transaction
            .prepare(
                "INSERT INTO inventory_items (
                    id, name, part_number, category, color, quantity, location, year, notes,
                    image, catalog_image, catalog_source_category, catalog_material,
                    created_at, updated_at
                 ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15)",
            )
            .map_err(|error| error.to_string())?;

        for item in items {
            let catalog_source_category = item.catalog.as_ref().map(|catalog| catalog.source_category.clone());
            let catalog_material = item.catalog.as_ref().map(|catalog| catalog.material.clone());
            insert
                .execute(params![
                    item.id,
                    item.name,
                    item.part_number,
                    item.category,
                    item.color,
                    item.quantity,
                    item.location,
                    item.year,
                    item.notes,
                    item.image,
                    item.catalog_image,
                    catalog_source_category,
                    catalog_material,
                    item.created_at,
                    item.updated_at
                ])
                .map_err(|error| error.to_string())?;
        }
    }

    transaction.commit().map_err(|error| error.to_string())
}

#[tauri::command]
pub fn load_color_records(state: State<'_, DatabaseState>) -> Result<Vec<ColorRecord>, String> {
    let connection = state
        .connection
        .lock()
        .map_err(|_| "The database connection is unavailable.".to_string())?;
    let mut statement = connection
        .prepare("SELECT id, name, hex, transparent, part_count FROM colors ORDER BY part_count DESC, name COLLATE NOCASE ASC")
        .map_err(|error| error.to_string())?;
    statement
        .query_map([], |row| {
            Ok(ColorRecord {
                id: row.get(0)?,
                name: row.get(1)?,
                hex: row.get(2)?,
                transparent: row.get::<_, i64>(3)? != 0,
                part_count: row.get(4)?,
            })
        })
        .map_err(|error| error.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub fn search_catalog_parts(
    state: State<'_, DatabaseState>,
    query: String,
    limit: i64,
) -> Result<Vec<PartRecord>, String> {
    let normalized = query.trim().to_lowercase();
    if normalized.len() < 3 {
        return Ok(Vec::new());
    }
    let limit = limit.clamp(1, 100);
    let connection = state
        .connection
        .lock()
        .map_err(|_| "The database connection is unavailable.".to_string())?;
    let mut statement = connection
        .prepare(
            "SELECT part_number, name, category, source_category, material
             FROM parts
             WHERE substr(lower(part_number), 1, length(?1)) = ?1
             ORDER BY length(part_number), part_number COLLATE NOCASE
             LIMIT ?2",
        )
        .map_err(|error| error.to_string())?;
    statement
        .query_map(params![normalized, limit], |row| {
            Ok(PartRecord {
                part_number: row.get(0)?,
                name: row.get(1)?,
                category: row.get(2)?,
                source_category: row.get(3)?,
                material: row.get(4)?,
            })
        })
        .map_err(|error| error.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub fn search_set_records(
    state: State<'_, DatabaseState>,
    query: String,
    limit: i64,
) -> Result<Vec<SetRecord>, String> {
    let normalized = query.trim().to_lowercase();
    if normalized.is_empty() {
        return Ok(Vec::new());
    }
    let limit = limit.clamp(1, 100);
    let connection = state
        .connection
        .lock()
        .map_err(|_| "The database connection is unavailable.".to_string())?;
    let mut statement = connection
        .prepare(
            "SELECT set_number, name, year, num_parts, image_url, inventory_id
             FROM sets
             WHERE instr(lower(set_number), ?1) > 0 OR instr(lower(name), ?1) > 0
             ORDER BY set_number COLLATE NOCASE
             LIMIT ?2",
        )
        .map_err(|error| error.to_string())?;
    statement
        .query_map(params![normalized, limit], |row| {
            Ok(SetRecord {
                set_number: row.get(0)?,
                name: row.get(1)?,
                year: row.get(2)?,
                num_parts: row.get(3)?,
                image_url: row.get(4)?,
                inventory_id: row.get(5)?,
            })
        })
        .map_err(|error| error.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub fn find_buildable_set_records(
    state: State<'_, DatabaseState>,
    limit: i64,
) -> Result<Vec<SetRecord>, String> {
    let limit = limit.clamp(1, 200);
    let connection = state
        .connection
        .lock()
        .map_err(|_| "The database connection is unavailable.".to_string())?;
    let mut statement = connection
        .prepare(
            "WITH owned AS (
                SELECT lower(trim(part_number)) AS part_number, color, SUM(quantity) AS quantity
                FROM inventory_items
                WHERE quantity > 0
                GROUP BY lower(trim(part_number)), color
             ),
             owned_total AS (
                SELECT COALESCE(SUM(quantity), 0) AS quantity
                FROM inventory_items
                WHERE quantity > 0
             )
             SELECT s.set_number, s.name, s.year, s.num_parts, s.image_url, s.inventory_id
             FROM sets s
             JOIN set_parts sp ON sp.inventory_id = s.inventory_id
             LEFT JOIN owned o ON o.part_number = lower(trim(sp.part_number)) AND o.color = sp.color
             CROSS JOIN owned_total total
             WHERE COALESCE(s.num_parts, 0) > 0
               AND COALESCE(s.num_parts, 0) <= total.quantity
             GROUP BY s.set_number, s.name, s.year, s.num_parts, s.image_url, s.inventory_id
             HAVING SUM(CASE WHEN COALESCE(o.quantity, 0) >= sp.quantity THEN 0 ELSE 1 END) = 0
             ORDER BY COALESCE(s.num_parts, 0) DESC, s.set_number COLLATE NOCASE
             LIMIT ?1",
        )
        .map_err(|error| error.to_string())?;
    statement
        .query_map([limit], |row| {
            Ok(SetRecord {
                set_number: row.get(0)?,
                name: row.get(1)?,
                year: row.get(2)?,
                num_parts: row.get(3)?,
                image_url: row.get(4)?,
                inventory_id: row.get(5)?,
            })
        })
        .map_err(|error| error.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub fn load_sql_set_parts(
    state: State<'_, DatabaseState>,
    inventory_id: i64,
) -> Result<Vec<SetPartRecord>, String> {
    let connection = state
        .connection
        .lock()
        .map_err(|_| "The database connection is unavailable.".to_string())?;
    let mut statement = connection
        .prepare(
            "SELECT part_number, color, quantity
             FROM set_parts
             WHERE inventory_id = ?1",
        )
        .map_err(|error| error.to_string())?;
    statement
        .query_map([inventory_id], |row| {
            Ok(SetPartRecord {
                part_number: row.get(0)?,
                color: row.get(1)?,
                quantity: row.get(2)?,
            })
        })
        .map_err(|error| error.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub fn find_sql_catalog_photo(
    state: State<'_, DatabaseState>,
    part_number: String,
    color: String,
) -> Result<Option<String>, String> {
    let normalized = part_number.trim().to_lowercase();
    let connection = state
        .connection
        .lock()
        .map_err(|_| "The database connection is unavailable.".to_string())?;
    let exact = connection
        .query_row(
            "SELECT image_url FROM catalog_photos WHERE lower(part_number) = ?1 AND color = ?2",
            params![normalized, color],
            |row| row.get(0),
        )
        .optional()
        .map_err(|error| error.to_string())?;
    if exact.is_some() {
        return Ok(exact);
    }
    connection
        .query_row(
            "SELECT image_url FROM catalog_photos WHERE lower(part_number) = ?1 LIMIT 1",
            [normalized],
            |row| row.get(0),
        )
        .optional()
        .map_err(|error| error.to_string())
}

fn import_reference_data(connection: &mut Connection, app: &tauri::AppHandle) -> Result<(), String> {
    let current_version = connection
        .query_row(
            "SELECT value FROM reference_meta WHERE key = 'referenceVersion'",
            [],
            |row| row.get::<_, String>(0),
        )
        .optional()
        .map_err(|error| error.to_string())?;
    if current_version.as_deref() == Some(REFERENCE_VERSION) {
        return Ok(());
    }

    let data_directory = locate_data_directory(app)
        .ok_or_else(|| "Reference CSV data directory was not found.".to_string())?;
    let transaction = connection.transaction().map_err(|error| error.to_string())?;
    transaction
        .execute_batch(
            "DELETE FROM catalog_photos;
             DELETE FROM set_parts;
             DELETE FROM sets;
             DELETE FROM parts;
             DELETE FROM colors;",
        )
        .map_err(|error| error.to_string())?;

    import_colors(&transaction, &data_directory.join("colors.csv"))?;
    import_parts(&transaction, &data_directory.join("catalog"))?;
    import_sets(&transaction, &data_directory.join("sets").join("index.csv"))?;
    import_set_parts(&transaction, &data_directory.join("sets").join("parts"))?;
    import_catalog_photos(&transaction, &data_directory.join("sets").join("photos"))?;

    transaction
        .execute(
            "INSERT INTO reference_meta(key, value)
             VALUES ('referenceVersion', ?1)
             ON CONFLICT(key) DO UPDATE SET value = excluded.value",
            [REFERENCE_VERSION],
        )
        .map_err(|error| error.to_string())?;
    transaction.commit().map_err(|error| error.to_string())
}

fn locate_data_directory(app: &tauri::AppHandle) -> Option<PathBuf> {
    let mut candidates = Vec::new();
    if let Ok(current) = std::env::current_dir() {
        candidates.push(current.join("data"));
        candidates.push(current.join("..").join("data"));
        candidates.push(current.join("dist").join("data"));
    }
    if let Ok(resource) = app.path().resource_dir() {
        candidates.push(resource.join("data"));
        candidates.push(resource.join("..").join("data"));
        candidates.push(resource.join("dist").join("data"));
    }
    candidates.into_iter().find(|path| {
        path.join("colors.csv").is_file()
            && path.join("catalog").is_dir()
            && path.join("sets").join("index.csv").is_file()
    })
}

fn import_colors(connection: &Connection, path: &Path) -> Result<(), String> {
    let mut reader = csv::Reader::from_path(path).map_err(|error| error.to_string())?;
    let mut insert = connection
        .prepare(
            "INSERT INTO colors(id, name, hex, transparent, part_count)
             VALUES (?1, ?2, ?3, ?4, ?5)",
        )
        .map_err(|error| error.to_string())?;
    for row in reader.records() {
        let record = row.map_err(|error| error.to_string())?;
        insert
            .execute(params![
                field(&record, 0),
                field(&record, 1),
                field(&record, 2),
                if field(&record, 3) == "true" { 1 } else { 0 },
                parse_i64(field(&record, 4))
            ])
            .map_err(|error| error.to_string())?;
    }
    Ok(())
}

fn import_parts(connection: &Connection, directory: &Path) -> Result<(), String> {
    let mut insert = connection
        .prepare(
            "INSERT INTO parts(part_number, name, category, source_category, material)
             VALUES (?1, ?2, ?3, ?4, ?5)",
        )
        .map_err(|error| error.to_string())?;
    for path in csv_files(directory)? {
        if path.file_name().and_then(|name| name.to_str()) == Some("manifest.csv") {
            continue;
        }
        let mut reader = csv::Reader::from_path(path).map_err(|error| error.to_string())?;
        for row in reader.records() {
            let record = row.map_err(|error| error.to_string())?;
            insert
                .execute(params![
                    field(&record, 0),
                    field(&record, 1),
                    field(&record, 2),
                    field(&record, 3),
                    field(&record, 4)
                ])
                .map_err(|error| error.to_string())?;
        }
    }
    Ok(())
}

fn import_sets(connection: &Connection, path: &Path) -> Result<(), String> {
    let mut reader = csv::Reader::from_path(path).map_err(|error| error.to_string())?;
    let mut insert = connection
        .prepare(
            "INSERT INTO sets(set_number, name, year, num_parts, image_url, inventory_id)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
        )
        .map_err(|error| error.to_string())?;
    for row in reader.records() {
        let record = row.map_err(|error| error.to_string())?;
        insert
            .execute(params![
                field(&record, 0),
                field(&record, 1),
                parse_i64(field(&record, 2)),
                parse_i64(field(&record, 3)),
                field(&record, 4),
                parse_i64(field(&record, 5))
            ])
            .map_err(|error| error.to_string())?;
    }
    Ok(())
}

fn import_set_parts(connection: &Connection, directory: &Path) -> Result<(), String> {
    let mut insert = connection
        .prepare(
            "INSERT INTO set_parts(inventory_id, part_number, color, quantity)
             VALUES (?1, ?2, ?3, ?4)
             ON CONFLICT(inventory_id, part_number, color)
             DO UPDATE SET quantity = quantity + excluded.quantity",
        )
        .map_err(|error| error.to_string())?;
    for path in csv_files(directory)? {
        let mut reader = csv::Reader::from_path(path).map_err(|error| error.to_string())?;
        for row in reader.records() {
            let record = row.map_err(|error| error.to_string())?;
            insert
                .execute(params![
                    parse_i64(field(&record, 0)),
                    field(&record, 1),
                    field(&record, 2),
                    parse_i64(field(&record, 3))
                ])
                .map_err(|error| error.to_string())?;
        }
    }
    Ok(())
}

fn import_catalog_photos(connection: &Connection, directory: &Path) -> Result<(), String> {
    let mut insert = connection
        .prepare(
            "INSERT OR IGNORE INTO catalog_photos(part_number, color, image_url)
             VALUES (?1, ?2, ?3)",
        )
        .map_err(|error| error.to_string())?;
    for path in csv_files(directory)? {
        let mut reader = csv::Reader::from_path(path).map_err(|error| error.to_string())?;
        for row in reader.records() {
            let record = row.map_err(|error| error.to_string())?;
            insert
                .execute(params![field(&record, 0), field(&record, 1), field(&record, 2)])
                .map_err(|error| error.to_string())?;
        }
    }
    Ok(())
}

fn csv_files(directory: &Path) -> Result<Vec<PathBuf>, String> {
    let mut files = fs::read_dir(directory)
        .map_err(|error| error.to_string())?
        .filter_map(|entry| entry.ok().map(|entry| entry.path()))
        .filter(|path| path.extension().and_then(|extension| extension.to_str()) == Some("csv"))
        .collect::<Vec<_>>();
    files.sort();
    Ok(files)
}

fn field(record: &csv::StringRecord, index: usize) -> &str {
    record.get(index).unwrap_or("")
}

fn parse_i64(value: &str) -> i64 {
    value.parse::<i64>().unwrap_or(0)
}
