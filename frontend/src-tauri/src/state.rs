/// Application state shared across commands
#[derive(Debug, Default)]
pub struct AppState {
    pub current_profile_id: Option<String>,
}

impl AppState {
    pub fn new() -> Self {
        Self {
            current_profile_id: None,
        }
    }
}
