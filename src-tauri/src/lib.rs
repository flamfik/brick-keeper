use serde::Serialize;
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use tauri::{Manager, State};
use tauri_plugin_dialog::DialogExt;

mod database;

#[derive(Serialize)]
struct InventoryFile {
    kind: &'static str,
    name: String,
}

#[derive(Default)]
struct InventoryPaths {
    connected: Option<PathBuf>,
    pending: Option<PathBuf>,
}

struct InventoryState(Mutex<InventoryPaths>);

fn inventory_file(path: &Path) -> InventoryFile {
    InventoryFile {
        kind: "tauri",
        name: path
            .file_name()
            .and_then(|value| value.to_str())
            .unwrap_or("brick-keeper.json")
            .to_string(),
    }
}

fn connected_path(state: &State<'_, InventoryState>) -> Result<PathBuf, String> {
    state
        .0
        .lock()
        .map_err(|_| "The connected-file state is unavailable.".to_string())?
        .connected
        .clone()
        .ok_or_else(|| "No inventory file is connected.".to_string())
}

fn readable_path(state: &State<'_, InventoryState>) -> Result<PathBuf, String> {
    let paths = state
        .0
        .lock()
        .map_err(|_| "The connected-file state is unavailable.".to_string())?;
    paths
        .pending
        .clone()
        .or_else(|| paths.connected.clone())
        .ok_or_else(|| "No inventory file is connected.".to_string())
}

fn state_file(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    app.path()
        .app_config_dir()
        .map(|directory| directory.join("inventory-path.txt"))
        .map_err(|error| error.to_string())
}

fn persist_connected_path(app: &tauri::AppHandle, path: &Path) -> Result<(), String> {
    let state_file = state_file(app)?;
    let directory = state_file
        .parent()
        .ok_or_else(|| "The application configuration directory is invalid.".to_string())?;
    fs::create_dir_all(directory).map_err(|error| error.to_string())?;
    fs::write(state_file, path.to_string_lossy().as_bytes()).map_err(|error| error.to_string())
}

/// Returns the file selected in a previous session. The native layer keeps the
/// path private, so JavaScript cannot redirect read or write commands.
#[tauri::command]
fn get_connected_inventory_file(
    state: State<'_, InventoryState>,
) -> Result<Option<InventoryFile>, String> {
    let path = state
        .0
        .lock()
        .map_err(|_| "The connected-file state is unavailable.".to_string())?
        .connected
        .clone();
    Ok(path.as_deref().map(inventory_file))
}

/// Opens the native file chooser and returns only the JSON file selected by
/// the user. Cancelling is represented by `None`, not an application error.
#[tauri::command]
fn pick_inventory_file(
    app: tauri::AppHandle,
    state: State<'_, InventoryState>,
) -> Result<Option<InventoryFile>, String> {
    let selection = app
        .dialog()
        .file()
        .add_filter("Brick Keeper JSON", &["json"])
        .blocking_pick_file();

    let Some(selection) = selection else {
        return Ok(None);
    };
    let path = selection
        .into_path()
        .map_err(|_| "The selected file does not have a local filesystem path.".to_string())?;
    let mut paths = state
        .0
        .lock()
        .map_err(|_| "The connected-file state is unavailable.".to_string())?;
    paths.pending = Some(path.clone());

    Ok(Some(inventory_file(&path)))
}

/// Commits the pending choice only after JavaScript has parsed and validated
/// its contents, so selecting an invalid file cannot replace a working link.
#[tauri::command]
fn confirm_inventory_file(
    app: tauri::AppHandle,
    state: State<'_, InventoryState>,
) -> Result<(), String> {
    let path = {
        let paths = state
            .0
            .lock()
            .map_err(|_| "The connected-file state is unavailable.".to_string())?;
        paths
            .pending
            .clone()
            .ok_or_else(|| "No inventory file is waiting for confirmation.".to_string())?
    };
    persist_connected_path(&app, &path)?;

    let mut paths = state
        .0
        .lock()
        .map_err(|_| "The connected-file state is unavailable.".to_string())?;
    paths.pending = None;
    paths.connected = Some(path);
    Ok(())
}

/// File contents cross the bridge as text so the existing JavaScript schema
/// migration and validation remain the single source of truth.
#[tauri::command]
fn read_inventory_file(state: State<'_, InventoryState>) -> Result<String, String> {
    let path = readable_path(&state)?;
    fs::read_to_string(path).map_err(|error| error.to_string())
}

/// Writes are initiated by the JavaScript save queue, preserving mutation
/// order when the user changes quantities in quick succession.
#[tauri::command]
fn write_inventory_file(
    state: State<'_, InventoryState>,
    contents: String,
) -> Result<(), String> {
    let path = connected_path(&state)?;
    fs::write(path, contents).map_err(|error| error.to_string())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .setup(|app| {
            let app_handle = app.handle().clone();
            let database = database::initialize_database(&app_handle)
                .map_err(|message| -> Box<dyn std::error::Error> {
                    Box::new(std::io::Error::new(std::io::ErrorKind::Other, message))
                })?;
            app.manage(database);
            let connected = app
                .path()
                .app_config_dir()
                .ok()
                .map(|directory| directory.join("inventory-path.txt"))
                .and_then(|path| fs::read_to_string(path).ok())
                .map(PathBuf::from)
                .filter(|path| path.is_file());
            app.manage(InventoryState(Mutex::new(InventoryPaths {
                connected,
                pending: None,
            })));
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            database::database_status,
            database::find_buildable_set_records,
            database::find_sql_catalog_photo,
            database::load_color_records,
            database::load_inventory_items,
            database::load_sql_set_parts,
            database::replace_inventory_items,
            database::search_catalog_parts,
            database::search_set_records,
            get_connected_inventory_file,
            pick_inventory_file,
            confirm_inventory_file,
            read_inventory_file,
            write_inventory_file
        ])
        .run(tauri::generate_context!())
        .expect("error while running Brick Keeper");
}
