mod commands;
mod state;
mod bridge;

use std::sync::{Arc, Mutex};
use state::AppState;
use tauri::Manager;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .manage(Mutex::new(AppState::new()))
        .setup(|app| {
            // Initialize bridge client wrapped in Arc
            let app_handle = app.handle().clone();
            match bridge::BridgeClient::new(app_handle.clone()) {
                Ok(client) => {
                    // Wrap in Arc so cloning only increases reference count
                    app.manage(Arc::new(client));
                    println!("Bridge client initialized successfully");
                }
                Err(e) => {
                    eprintln!("Failed to initialize bridge client: {}", e);
                    eprintln!("WARNING: Application will not function properly without bridge client!");
                }
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            // Chat commands
            commands::send_message,
            commands::stop_message_stream,
            // Profile commands
            commands::create_profile,
            commands::switch_profile,
            commands::list_profiles,
            commands::delete_profile,
            commands::get_current_profile,
            commands::login_with_api_key,
            // Context commands
            commands::add_context_paths,
            commands::read_file,
            // Auth commands
            commands::check_provider_auth,
            commands::trigger_provider_login,
            // Permission commands
            commands::approve_action,
            commands::reject_action,
            commands::set_permission_mode,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
