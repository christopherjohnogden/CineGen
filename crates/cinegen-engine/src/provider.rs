use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ProviderCapabilities {
    pub supports_image: bool,
    pub supports_video: bool,
    pub max_duration_seconds: u32,
    pub supported_resolutions: Vec<String>,
    pub supports_seed: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ProviderConfig {
    pub endpoint: Option<String>,
    pub api_key_ref: Option<String>,
    pub model: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SubmitJobRequest {
    pub prompt: String,
    pub negative_prompt: Option<String>,
    pub duration_seconds: u32,
    pub resolution: String,
    pub seed: Option<u64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SubmitJobResponse {
    pub external_job_id: String,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
pub enum ProviderJobStatus {
    Queued,
    Running,
    Succeeded,
    Failed,
    Canceled,
}

pub trait Provider {
    fn validate_config(&self, config: &ProviderConfig) -> Result<(), String>;
    fn submit_job(
        &self,
        config: &ProviderConfig,
        request: &SubmitJobRequest,
    ) -> Result<SubmitJobResponse, String>;
    fn poll_job(
        &self,
        config: &ProviderConfig,
        external_job_id: &str,
    ) -> Result<ProviderJobStatus, String>;
    fn download_outputs(
        &self,
        config: &ProviderConfig,
        external_job_id: &str,
    ) -> Result<Vec<String>, String>;
    fn cancel_job(&self, config: &ProviderConfig, external_job_id: &str) -> Result<(), String>;
    fn capabilities(&self) -> ProviderCapabilities;
}
