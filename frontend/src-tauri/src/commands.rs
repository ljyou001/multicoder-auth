use tauri::AppHandle;
use serde::{Serialize, Deserialize};
use std::sync::{Arc, Mutex};
use crate::state::AppState;
use crate::bridge::BridgeClient;
#[cfg(target_os = "windows")]
use std::os::windows::process::CommandExt;

// Helper to get bridge client or return error
fn get_bridge(bridge_state: &tauri::State<Arc<BridgeClient>>) -> Result<Arc<BridgeClient>, String> {
    Ok(bridge_state.inner().clone())
}

// ============================================================================
// Types
// ============================================================================



#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ContextItem {
    pub id: String,
    pub path: String,
    pub r#type: String, // "file" or "directory"
    pub size: Option<u64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type")]
pub enum ProviderEvent {
    #[serde(rename = "text")]
    Text { content: String },
    #[serde(rename = "file")]
    File { path: String, contents: String },
    #[serde(rename = "shell")]
    Shell { command: String },
    #[serde(rename = "ask")]
    Ask { reason: String, action: String },
    #[serde(rename = "progress")]
    Progress { message: String },
    #[serde(rename = "error")]
    Error { message: String, recoverable: Option<bool> },
    #[serde(rename = "done")]
    Done,
}

// ============================================================================
// Chat Commands
// ============================================================================

#[tauri::command]
pub async fn send_message(
    _app: AppHandle,
    _app_state: tauri::State<'_, Mutex<AppState>>,
    bridge_state: tauri::State<'_, Arc<BridgeClient>>,
    profile: String,
    provider: String,
    message: String,
    _context: Vec<String>,
) -> Result<(), String> {
    println!("send_message called: profile={}, provider={}, message_len={}", profile, provider, message.len());

    // Get Arc clone (just increments reference count, doesn't trigger Drop)
    let bridge_clone = get_bridge(&bridge_state)?;

    // Launch provider session if not already started
    // The bridge will handle session management internally
    let launch_result = bridge_clone.launch(
        profile.clone(),
        provider.clone(),
        serde_json::json!({
            "profileName": profile,
            "workingDir": std::env::current_dir().unwrap().to_string_lossy(),
            "permissionMode": "ask",
        })
    ).await;

    match launch_result {
        Ok(_) => println!("Provider session launched/reused successfully"),
        Err(e) => {
            // Session might already exist, that's ok
            println!("Launch note: {}", e);
        }
    }

    // Send the message
    bridge_clone.send_message(profile, message).await?;

    Ok(())
}

#[tauri::command]
pub async fn stop_message_stream(
    app_state: tauri::State<'_, Mutex<AppState>>,
    bridge_state: tauri::State<'_, Arc<BridgeClient>>,
) -> Result<(), String> {
    let profile_id = {
        let state = app_state.lock().unwrap();
        state.current_profile_id.clone()
            .ok_or("No profile selected")?
    };

    let bridge_clone = get_bridge(&bridge_state)?;

    // Stop the provider session
    bridge_clone.stop(profile_id).await?;

    Ok(())
}

// ============================================================================
// Profile Commands
// ============================================================================

#[tauri::command]
pub async fn create_profile(
    _state: tauri::State<'_, Mutex<AppState>>,
    bridge_state: tauri::State<'_, Arc<BridgeClient>>,
    name: String,
    provider: String,
) -> Result<serde_json::Value, String> {
    println!("create_profile: name={}, provider={}", name, provider);

    let bridge_clone = get_bridge(&bridge_state)?;
    let result = bridge_clone.create_profile(name, provider).await?;
    
    Ok(result)
}

#[tauri::command]
pub async fn switch_profile(
    _state: tauri::State<'_, Mutex<AppState>>,
    bridge_state: tauri::State<'_, Arc<BridgeClient>>,
    profile_id: String,
) -> Result<serde_json::Value, String> {
    println!("switch_profile: profile_id={}", profile_id);

    let bridge_clone = get_bridge(&bridge_state)?;
    let result = bridge_clone.switch_profile(profile_id).await?;
    
    Ok(result)
}

#[tauri::command]
pub async fn list_profiles(
    _state: tauri::State<'_, Mutex<AppState>>,
    bridge_state: tauri::State<'_, Arc<BridgeClient>>,
) -> Result<serde_json::Value, String> {
    let bridge_clone = get_bridge(&bridge_state)?;
    let result = bridge_clone.list_profiles().await?;
    
    Ok(result)
}

#[tauri::command]
pub async fn delete_profile(
    _state: tauri::State<'_, Mutex<AppState>>,
    bridge_state: tauri::State<'_, Arc<BridgeClient>>,
    profile_id: String,
) -> Result<serde_json::Value, String> {
    let bridge_clone = get_bridge(&bridge_state)?;
    let result = bridge_clone.delete_profile(profile_id).await?;
    
    Ok(result)
}

#[tauri::command]
pub async fn get_current_profile(
    bridge_state: tauri::State<'_, Arc<BridgeClient>>,
) -> Result<serde_json::Value, String> {
    let bridge_clone = get_bridge(&bridge_state)?;
    let result = bridge_clone.get_current_profile().await?;
    
    Ok(result)
}

#[tauri::command]
pub async fn login_with_api_key(
    bridge_state: tauri::State<'_, Arc<BridgeClient>>,
    profile_name: String,
    provider: String,
    api_key: String,
    metadata: Option<serde_json::Value>,
) -> Result<serde_json::Value, String> {
    let bridge_clone = get_bridge(&bridge_state)?;
    let result = bridge_clone.login_with_api_key(profile_name, provider, api_key, metadata).await?;

    Ok(result)
}

// ============================================================================
// Context Commands
// ============================================================================

#[tauri::command]
pub async fn add_context_paths(
    paths: Vec<String>,
) -> Result<Vec<ContextItem>, String> {
    let mut items = Vec::new();

    for path in paths {
        let metadata = std::fs::metadata(&path)
            .map_err(|e| format!("Failed to read {}: {}", path, e))?;

        items.push(ContextItem {
            id: uuid::Uuid::new_v4().to_string(),
            path,
            r#type: if metadata.is_dir() { "directory" } else { "file" }.to_string(),
            size: Some(metadata.len()),
        });
    }

    Ok(items)
}

#[tauri::command]
pub async fn read_file(path: String) -> Result<String, String> {
    std::fs::read_to_string(&path)
        .map_err(|e| format!("Failed to read {}: {}", path, e))
}

// ============================================================================
// Auth Commands
// ============================================================================

#[tauri::command]
pub async fn check_provider_auth(
    _state: tauri::State<'_, Mutex<AppState>>,
    bridge_state: tauri::State<'_, Arc<BridgeClient>>,
    provider: String,
    profile_name: String,
) -> Result<bool, String> {
    println!("check_provider_auth: provider={}, profile_name={}", provider, profile_name);

    // Get Arc clone (just increments reference count)
    let bridge_clone = get_bridge(&bridge_state)?;

    // Call bridge to check auth
    match bridge_clone.check_auth(provider, profile_name).await {
        Ok(result) => {
            // Parse the result to get 'valid' field
            if let Some(valid) = result.get("valid").and_then(|v| v.as_bool()) {
                Ok(valid)
            } else {
                Ok(false)
            }
        }
        Err(e) => {
            println!("Error checking auth: {}", e);
            Ok(false)
        }
    }
}

#[tauri::command]
pub async fn get_auth_options(
    bridge_state: tauri::State<'_, Arc<BridgeClient>>,
    profile_name: String,
    provider: String,
) -> Result<serde_json::Value, String> {
    let bridge_clone = get_bridge(&bridge_state)?;
    bridge_clone
        .get_auth_options(profile_name, provider)
        .await
}

#[tauri::command]
pub async fn link_existing_credential(
    bridge_state: tauri::State<'_, Arc<BridgeClient>>,
    profile_name: String,
    provider: String,
) -> Result<serde_json::Value, String> {
    let bridge_clone = get_bridge(&bridge_state)?;
    bridge_clone
        .link_existing_credential(profile_name, provider)
        .await
}

#[tauri::command]
pub async fn trigger_provider_login(provider: String) -> Result<String, String> {
    println!("trigger_provider_login: provider={}", provider);

    use std::process::Command;

    // Trigger the native CLI login
    let command = match provider.as_str() {
        "codex" => {
            let mut cmd = Command::new(if cfg!(target_os = "windows") { "codex.cmd" } else { "codex" });
            cmd.arg("login");
            #[cfg(target_os = "windows")]
            {
                const CREATE_NO_WINDOW: u32 = 0x0800_0000;
                cmd.creation_flags(CREATE_NO_WINDOW);
            }
            let output = cmd.output();
            match output {
                Ok(_) => Ok("Login initiated. Please complete in browser.".to_string()),
                Err(e) => Err(format!("Failed to start codex login: {}", e)),
            }
        },
        "claude" => {
            // For Claude, open a new terminal window for interactive authentication
            if cfg!(target_os = "windows") {
                // Windows: use 'start' to open a new command window
                let result = Command::new("cmd")
                    .args(&["/C", "start", "cmd", "/K", "claude.cmd setup-token"])
                    .spawn();
                match result {
                    Ok(_) => Ok("Opening terminal window for Claude authentication. Please follow the instructions in the terminal.".to_string()),
                    Err(e) => Err(format!("Failed to open terminal for claude auth: {}", e)),
                }
            } else if cfg!(target_os = "macos") {
                // macOS: use AppleScript to open Terminal
                let result = Command::new("osascript")
                    .args(&[
                        "-e",
                        "tell application \"Terminal\" to do script \"claude setup-token\"",
                    ])
                    .spawn();
                match result {
                    Ok(_) => Ok("Opening terminal window for Claude authentication. Please follow the instructions in the terminal.".to_string()),
                    Err(e) => Err(format!("Failed to open terminal for claude auth: {}", e)),
                }
            } else {
                // Linux: try common terminal emulators
                let terminals = vec![
                    ("gnome-terminal", vec!["--", "claude", "setup-token"]),
                    ("konsole", vec!["-e", "claude", "setup-token"]),
                    ("xterm", vec!["-e", "claude", "setup-token"]),
                ];

                let mut success = false;
                for (term, args) in terminals {
                    if let Ok(_) = Command::new(term).args(&args).spawn() {
                        success = true;
                        break;
                    }
                }

                if success {
                    Ok("Opening terminal window for Claude authentication. Please follow the instructions in the terminal.".to_string())
                } else {
                    Err("Failed to open terminal. Please run 'claude setup-token' manually in your terminal.".to_string())
                }
            }
        },
        "gemini" => {
            // Run a simple query to trigger OAuth flow (gemini CLI opens browser automatically)
            if cfg!(target_os = "windows") {
                // Use `start` so the CLI runs in its own console without blocking the app
                // Launch minimized to reduce visual disruption while still allowing interaction
                let result = Command::new("cmd")
                    .args(&["/C", "start", "/MIN", "", "gemini.cmd", "hello"])
                    .spawn();
                match result {
                    Ok(_) => Ok("Login initiated. Gemini CLI will open browser for authentication.".to_string()),
                    Err(e) => Err(format!("Failed to start gemini login: {}", e)),
                }
            } else {
                let output = Command::new("gemini").arg("hello").output();
                match output {
                    Ok(_) => Ok("Login initiated. Gemini CLI will open browser for authentication.".to_string()),
                    Err(e) => Err(format!("Failed to start gemini login: {}", e)),
                }
            }
        },
        _ => Err(format!("Unknown provider: {}", provider)),
    };

    command
}

// ============================================================================
// Permission Commands
// ============================================================================

#[tauri::command]
pub async fn approve_action(
    action_id: String,
    apply_to_session: bool,
) -> Result<(), String> {
    println!("approve_action: id={}, apply_to_session={}", action_id, apply_to_session);
    // TODO: Execute the approved action
    Ok(())
}

#[tauri::command]
pub async fn reject_action(
    action_id: String,
) -> Result<(), String> {
    println!("reject_action: id={}", action_id);
    Ok(())
}

#[tauri::command]
pub async fn set_permission_mode(
    _state: tauri::State<'_, Mutex<AppState>>,
    _mode: String,
) -> Result<(), String> {
    // TODO: Update current profile's permission mode
    Ok(())
}
