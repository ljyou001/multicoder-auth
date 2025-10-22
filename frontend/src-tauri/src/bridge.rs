use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::io::{BufRead, BufReader, Write};
use std::process::{Child, ChildStdin, ChildStdout, Command, Stdio};
use std::sync::{Arc, Mutex};
use std::time::Duration;
use tauri::{path::BaseDirectory, AppHandle, Emitter, Manager};
use tokio::sync::oneshot;

// ============================================================================
// JSON-RPC Types
// ============================================================================

#[derive(Debug, Clone, Serialize)]
struct JsonRpcRequest {
    id: u64,
    method: String,
    params: serde_json::Value,
}

#[derive(Debug, Clone, Deserialize)]
struct JsonRpcResponse {
    id: u64,
    #[serde(skip_serializing_if = "Option::is_none")]
    result: Option<serde_json::Value>,
    #[serde(skip_serializing_if = "Option::is_none")]
    error: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
struct JsonRpcEvent {
    event: String,
    data: serde_json::Value,
}

// ============================================================================
// Bridge Client
// ============================================================================

type PendingRequest = oneshot::Sender<Result<serde_json::Value, String>>;

// Note: BridgeClient should be wrapped in Arc, not cloned directly
pub struct BridgeClient {
    child: Arc<Mutex<Option<Child>>>,
    stdin: Arc<Mutex<Option<ChildStdin>>>,
    next_id: Arc<Mutex<u64>>,
    pending: Arc<Mutex<HashMap<u64, PendingRequest>>>,
    app_handle: AppHandle,
    ready: Arc<Mutex<bool>>,
}

impl BridgeClient {
    /// Find the bridge service either from bundled resources or by searching up from current directory
    fn find_bridge_service(app_handle: &AppHandle) -> Result<std::path::PathBuf, String> {
        // First try the bundled resource path. This works for packaged builds.
        if let Ok(resource_path) = app_handle
            .path()
            .resolve("dist/bridge/provider-bridge.js", BaseDirectory::Resource)
        {
            println!("Checking bundled bridge resource at: {:?}", resource_path);
            if resource_path.exists() {
                println!(
                    "Found bridge service via resource resolver at: {:?}",
                    resource_path
                );
                return Ok(resource_path);
            }
        }

        // Fallback to searching relative to current directory (useful for dev builds)
        let mut current = std::env::current_dir()
            .map_err(|e| format!("Failed to get current dir: {}", e))?;

        println!("Starting bridge search from: {:?}", current);

        // Search up to 5 levels
        for level in 0..5 {
            let candidate = current.join("dist").join("bridge").join("provider-bridge.js");

            println!("Level {}: Checking bridge path: {:?}", level, candidate);

            if candidate.exists() {
                println!("Found bridge service at: {:?}", candidate);
                return Ok(candidate);
            }

            // Go up one level
            if let Some(parent) = current.parent() {
                current = parent.to_path_buf();
            } else {
                break;
            }
        }

        // If not found, provide helpful error message
        let current_dir = std::env::current_dir()
            .map(|p| p.display().to_string())
            .unwrap_or_else(|_| "unknown".to_string());

        Err(format!(
            "Could not find bridge service (dist/bridge/provider-bridge.js). \
            Current directory: {}. \
            Please ensure the project is built with 'npm run build' before running the Tauri app.",
            current_dir
        ))
    }

    /// Create a new bridge client and start the Node.js bridge service
    pub fn new(app_handle: AppHandle) -> Result<Self, String> {
        // Find the bridge executable by searching up from current directory
        let bridge_path = Self::find_bridge_service(&app_handle)?;

        // Check if running in development or production
        let node_cmd = if cfg!(target_os = "windows") {
            "node.exe"
        } else {
            "node"
        };

        println!("Starting bridge service at: {:?}", bridge_path);

        // Use user's home directory as working directory
        // This ensures bridge can access native CLI tools and profile configurations
        // regardless of where the app is installed
        let working_dir = dirs::home_dir()
            .ok_or("Failed to determine user home directory")?;

        println!("Setting bridge working directory to user home: {:?}", working_dir);

        // Spawn the Node.js bridge service with stderr piped for better error capture
        let mut command = Command::new(node_cmd);
        command
            .arg(&bridge_path)
            .current_dir(working_dir)
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped());

        // On Windows, hide the console window
        #[cfg(target_os = "windows")]
        {
            use std::os::windows::process::CommandExt;
            const CREATE_NO_WINDOW: u32 = 0x08000000;
            command.creation_flags(CREATE_NO_WINDOW);
        }

        let mut child = command
            .spawn()
            .map_err(|e| format!("Failed to spawn bridge service: {}", e))?;

        let stdin = child.stdin.take().ok_or("Failed to get stdin")?;
        let stdout = child.stdout.take().ok_or("Failed to get stdout")?;
        let stderr = child.stderr.take().ok_or("Failed to get stderr")?;

        let client = Self {
            child: Arc::new(Mutex::new(Some(child))),
            stdin: Arc::new(Mutex::new(Some(stdin))),
            next_id: Arc::new(Mutex::new(1)),
            pending: Arc::new(Mutex::new(HashMap::new())),
            app_handle: app_handle.clone(),
            ready: Arc::new(Mutex::new(false)),
        };

        // Start reading from stdout in a separate thread
        client.start_reader(stdout);

        // Start reading from stderr in a separate thread
        client.start_stderr_reader(stderr);

        // Wait for ready event with timeout
        let ready_clone = Arc::clone(&client.ready);
        let start = std::time::Instant::now();
        let timeout = Duration::from_secs(5);

        while start.elapsed() < timeout {
            if *ready_clone.lock().unwrap() {
                println!("Bridge service is ready!");
                return Ok(client);
            }
            std::thread::sleep(Duration::from_millis(100));
        }

        // If we get here, bridge didn't send ready event
        eprintln!("WARNING: Bridge service did not send ready event within 5 seconds");
        eprintln!("The bridge may not be fully initialized. Some features may not work.");

        Ok(client)
    }

    /// Start a background thread to read from bridge service stdout
    fn start_reader(&self, stdout: ChildStdout) {
        let pending = Arc::clone(&self.pending);
        let app_handle = self.app_handle.clone();
        let ready = Arc::clone(&self.ready);
        let stdin_ref = Arc::clone(&self.stdin);

        std::thread::spawn(move || {
            let reader = BufReader::new(stdout);

            println!("[Rust Bridge] stdout reader thread started");

            for line in reader.lines() {
                match line {
                    Ok(line) if !line.trim().is_empty() => {
                        if let Err(e) = Self::handle_message(&line, &pending, &app_handle, &ready) {
                            eprintln!("[Rust Bridge] Error handling message: {}", e);
                        }
                    }
                    Ok(_) => {
                        // Empty line, continue
                    }
                    Err(e) => {
                        eprintln!("[Rust Bridge] ERROR: Failed to read line from bridge stdout: {}", e);
                        eprintln!("[Rust Bridge] This usually means the bridge process stdout was closed");
                        break;
                    }
                }
            }

            println!("[Rust Bridge] Bridge stdout reader thread exiting - EOF reached");

            // Mark stdin as closed so we know the process is dead
            {
                let mut stdin_guard = stdin_ref.lock().unwrap();
                *stdin_guard = None;
                println!("[Rust Bridge] Marked stdin as closed due to stdout EOF");
            }
        });
    }

    /// Start a background thread to read from bridge service stderr
    fn start_stderr_reader(&self, stderr: std::process::ChildStderr) {
        std::thread::spawn(move || {
            let reader = BufReader::new(stderr);

            println!("[Rust Bridge] stderr reader thread started");

            for line in reader.lines() {
                match line {
                    Ok(line) if !line.trim().is_empty() => {
                        eprintln!("[Bridge stderr] {}", line);
                    }
                    Ok(_) => {
                        // Empty line, continue
                    }
                    Err(e) => {
                        eprintln!("[Rust Bridge] ERROR: Failed to read line from bridge stderr: {}", e);
                        eprintln!("[Rust Bridge] This usually means the bridge process stderr was closed");
                        break;
                    }
                }
            }

            println!("[Rust Bridge] Bridge stderr reader thread exiting - EOF reached");
        });
    }

    /// Handle a message from the bridge service
    fn handle_message(
        line: &str,
        pending: &Arc<Mutex<HashMap<u64, PendingRequest>>>,
        app_handle: &AppHandle,
        ready: &Arc<Mutex<bool>>,
    ) -> Result<(), String> {
        println!("[Rust Bridge] Handling message from bridge: {}", if line.len() > 100 { &line[..100] } else { line });

        // Try parsing as response first
        if let Ok(response) = serde_json::from_str::<JsonRpcResponse>(line) {
            println!("[Rust Bridge] Parsed as JSON-RPC response, id={}", response.id);
            let mut pending_map = pending.lock().unwrap();
            if let Some(sender) = pending_map.remove(&response.id) {
                println!("[Rust Bridge] Found pending request for id={}", response.id);
                let result = if let Some(error) = response.error {
                    eprintln!("[Rust Bridge] Response contains error: {}", error);
                    Err(error)
                } else {
                    println!("[Rust Bridge] Response contains result");
                    Ok(response.result.unwrap_or(serde_json::Value::Null))
                };
                let _ = sender.send(result);
                println!("[Rust Bridge] Sent result to waiting request");
            } else {
                eprintln!("[Rust Bridge] WARNING: No pending request found for id={}", response.id);
            }
            return Ok(());
        }

        // Try parsing as event
        if let Ok(event) = serde_json::from_str::<JsonRpcEvent>(line) {
            println!("[Rust Bridge] Parsed as event: {}", event.event);
            match event.event.as_str() {
                "ready" => {
                    println!("Bridge service ready: {:?}", event.data);
                    *ready.lock().unwrap() = true;
                }
                "message" => {
                    println!("[Rust Bridge] Forwarding message event to frontend");
                    // Forward message event to frontend
                    if let Err(e) = app_handle.emit("message-stream", event.data) {
                        eprintln!("Failed to emit message-stream event: {}", e);
                    }
                }
                _ => {
                    println!("Unknown event: {}", event.event);
                }
            }
            return Ok(());
        }

        // If we get here, it's an unknown message format
        eprintln!("[Rust Bridge] Unknown message format: {}", line);
        Ok(())
    }

    /// Check if bridge process is still alive and ready
    fn is_alive(&self) -> bool {
        // Check if process is running
        let process_alive = {
            let child_guard = self.child.lock().unwrap();
            if let Some(_child) = child_guard.as_ref() {
                self.stdin.lock().unwrap().is_some()
            } else {
                false
            }
        };

        // Check if bridge sent ready event
        let is_ready = *self.ready.lock().unwrap();

        if process_alive && !is_ready {
            eprintln!("Bridge process is running but not ready yet");
        }

        process_alive && is_ready
    }

    /// Send a request to the bridge service
    async fn send_request(
        &self,
        method: String,
        params: serde_json::Value,
    ) -> Result<serde_json::Value, String> {
        println!("[Rust Bridge] Sending request: method={}", method);

        // Check if bridge is alive before sending
        if !self.is_alive() {
            eprintln!("[Rust Bridge] ERROR: Bridge is not alive!");
            return Err("Bridge process is not running. Please restart the application.".to_string());
        }

        let id = {
            let mut next_id = self.next_id.lock().unwrap();
            let id = *next_id;
            *next_id += 1;
            id
        };

        println!("[Rust Bridge] Request ID: {}", id);

        let request = JsonRpcRequest { id, method: method.clone(), params };

        let (tx, rx) = oneshot::channel();

        // Register the pending request
        {
            let mut pending = self.pending.lock().unwrap();
            pending.insert(id, tx);
            println!("[Rust Bridge] Registered pending request {}", id);
        }

        // Send the request
        {
            let mut stdin = self.stdin.lock().unwrap();
            if let Some(stdin) = stdin.as_mut() {
                let json = serde_json::to_string(&request).map_err(|e| e.to_string())?;
                println!("[Rust Bridge] Writing to stdin: {}", json);
                match writeln!(stdin, "{}", json) {
                    Ok(_) => {
                        println!("[Rust Bridge] Write successful");
                    },
                    Err(e) => {
                        eprintln!("[Rust Bridge] ERROR: Write failed: {}", e);
                        // Remove pending request on write error
                        self.pending.lock().unwrap().remove(&id);
                        return Err(format!("Bridge process closed unexpectedly: {}. Please check the bridge service logs and restart the application.", e));
                    }
                }
                match stdin.flush() {
                    Ok(_) => {
                        println!("[Rust Bridge] Flush successful");
                    },
                    Err(e) => {
                        eprintln!("[Rust Bridge] ERROR: Flush failed: {}", e);
                        // Remove pending request on flush error
                        self.pending.lock().unwrap().remove(&id);
                        return Err(format!("Bridge process closed unexpectedly: {}. Please check the bridge service logs and restart the application.", e));
                    }
                }
            } else {
                eprintln!("[Rust Bridge] ERROR: stdin not available");
                return Err("Bridge stdin not available. Please restart the application.".to_string());
            }
        }

        println!("[Rust Bridge] Waiting for response to request {}...", id);

        // Wait for response
        let result = rx.await.map_err(|_| "Request cancelled".to_string())?;
        println!("[Rust Bridge] Received response for request {}", id);
        result
    }

    /// Launch a provider session
    pub async fn launch(
        &self,
        profile: String,
        provider: String,
        config: serde_json::Value,
    ) -> Result<serde_json::Value, String> {
        self.send_request(
            "launch".to_string(),
            serde_json::json!({
                "profile": profile,
                "provider": provider,
                "config": config,
            }),
        )
        .await
    }

    /// Send a message to the provider
    pub async fn send_message(
        &self,
        profile: String,
        message: String,
    ) -> Result<serde_json::Value, String> {
        self.send_request(
            "sendMessage".to_string(),
            serde_json::json!({
                "profile": profile,
                "message": message,
            }),
        )
        .await
    }

    /// Stop a provider session
    pub async fn stop(&self, profile: String) -> Result<serde_json::Value, String> {
        self.send_request(
            "stop".to_string(),
            serde_json::json!({
                "profile": profile,
            }),
        )
        .await
    }

    /// List available providers
    pub async fn list_providers(&self) -> Result<serde_json::Value, String> {
        self.send_request("listProviders".to_string(), serde_json::json!({}))
            .await
    }

    /// Check authentication status for a provider
    pub async fn check_auth(
        &self,
        provider: String,
        profile_name: String,
    ) -> Result<serde_json::Value, String> {
        self.send_request(
            "checkAuth".to_string(),
            serde_json::json!({
                "provider": provider,
                "profileName": profile_name,
            }),
        )
        .await
    }

    /// List all profiles
    pub async fn list_profiles(&self) -> Result<serde_json::Value, String> {
        self.send_request("listProfiles".to_string(), serde_json::json!({}))
            .await
    }

    /// Create a new profile
    pub async fn create_profile(
        &self,
        name: String,
        provider: String,
    ) -> Result<serde_json::Value, String> {
        self.send_request(
            "createProfile".to_string(),
            serde_json::json!({
                "name": name,
                "provider": provider,
            }),
        )
        .await
    }

    /// Switch to a different profile
    pub async fn switch_profile(&self, profile_id: String) -> Result<serde_json::Value, String> {
        self.send_request(
            "switchProfile".to_string(),
            serde_json::json!({
                "profileId": profile_id,
            }),
        )
        .await
    }

    /// Delete a profile
    pub async fn delete_profile(&self, profile_id: String) -> Result<serde_json::Value, String> {
        self.send_request(
            "deleteProfile".to_string(),
            serde_json::json!({
                "profileId": profile_id,
            }),
        )
        .await
    }

    /// Get current profile
    pub async fn get_current_profile(&self) -> Result<serde_json::Value, String> {
        self.send_request("getCurrentProfile".to_string(), serde_json::json!({}))
            .await
    }

    /// Login with API key
    pub async fn login_with_api_key(
        &self,
        profile_name: String,
        provider: String,
        api_key: String,
        metadata: Option<serde_json::Value>,
    ) -> Result<serde_json::Value, String> {
        let mut params = serde_json::json!({
            "profileName": profile_name,
            "provider": provider,
            "apiKey": api_key,
        });

        if let Some(meta) = metadata {
            params["metadata"] = meta;
        }

        self.send_request("loginWithApiKey".to_string(), params)
            .await
    }

    /// Get authentication options for a provider/profile combination
    pub async fn get_auth_options(
        &self,
        profile_name: String,
        provider: String,
    ) -> Result<serde_json::Value, String> {
        self.send_request(
            "getAuthOptions".to_string(),
            serde_json::json!({
                "profileName": profile_name,
                "provider": provider,
            }),
        )
        .await
    }

    /// Link existing credentials to a profile
    pub async fn link_existing_credential(
        &self,
        profile_name: String,
        provider: String,
    ) -> Result<serde_json::Value, String> {
        self.send_request(
            "linkExistingCredential".to_string(),
            serde_json::json!({
                "profileName": profile_name,
                "provider": provider,
            }),
        )
        .await
    }

    /// Shutdown the bridge service
    pub fn shutdown(&self) {
        println!("[Rust Bridge] shutdown() called - killing bridge process");
        if let Some(mut child) = self.child.lock().unwrap().take() {
            println!("[Rust Bridge] Killing bridge process...");
            let _ = child.kill();
            let _ = child.wait();
            println!("[Rust Bridge] Bridge process killed");
        } else {
            println!("[Rust Bridge] No child process to kill");
        }
    }
}

impl Drop for BridgeClient {
    fn drop(&mut self) {
        println!("[Rust Bridge] Drop called on BridgeClient - shutting down bridge process");
        println!("[Rust Bridge] Note: This should only happen once when the application exits");
        self.shutdown();
    }
}
