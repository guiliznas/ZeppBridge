//! Réplicas do `get_app_status` (`src-tauri/src/commands/status.rs`) e do `get_official_status`
//! (`src-tauri/src/commands/official.rs`), sem o `AppState` do desktop.
//!
//! Diferenças deliberadas, porque o modo web não faz a verificação de rede da inicialização do desktop
//! nem guarda estado de sessão:
//! - `auth_state` é `"configured"` quando há credencial salva (o desktop vira `"verified"` depois de
//!   validar o token na rede);
//! - não há `startup_warning`, `auth_warning` nem `region_confidence` (vai `"unknown"`, o mesmo valor
//!   que o desktop usa depois de reiniciar);
//! - o status oficial não tenta renovar token vencido (renovar escreve na biblioteca).

use crate::commands::read;
use crate::ipc_error::AppError;
use crate::ipc_types::{capability_views, stream_views, AppStatus};
use chrono::Local;
use serde::Serialize;
use std::path::Path;
use zeppbridge_core::auth::AuthManager;
use zeppbridge_core::official::OfficialStore;

/// Cópia de `mask_user_id` (`src-tauri/src/app_state.rs`).
fn mask_user_id(user_id: &str) -> String {
    let chars: Vec<char> = user_id.chars().collect();
    match chars.len() {
        0 => String::new(),
        1 => "•".to_string(),
        2 => format!("{}•", chars[0]),
        _ => format!("{}•••{}", chars[0], chars[chars.len() - 1]),
    }
}

pub async fn build_app_status(data_dir: &Path) -> Result<AppStatus, AppError> {
    let auth_status = AuthManager::new(data_dir.to_path_buf()).status()?;

    let storage_dir = data_dir.to_path_buf();
    let today = Local::now().date_naive();
    let (statuses, freshness, (last_cloud_sync_at, last_cloud_sync_outcome), prefs, storage, coverage, full_refresh_due) =
        read(data_dir, move |db| {
            let statuses = db.list_data_status()?;
            let freshness = db.stream_freshness()?;
            let cloud_metadata = db.cloud_sync_metadata()?;
            let prefs = db.user_prefs()?;
            let storage = db.storage_estimate(prefs.history_sync_days, &storage_dir)?;
            let coverage = db.local_coverage(today)?;
            let full_refresh_due = db.full_window_refresh_due(chrono::Utc::now())?;
            Ok((statuses, freshness, cloud_metadata, prefs, storage, coverage, full_refresh_due))
        })
        .await?;

    let auth_state = if auth_status.configured { "configured" } else { "unconfigured" }.to_string();
    let official = OfficialStore::new(data_dir).meta().ok().flatten();
    let official_ok = official.as_ref().is_some_and(|meta| !meta.needs_reauth);
    let data_source = match (auth_status.configured, official_ok) {
        (true, true) => "both",
        (true, false) => "legacy",
        (false, true) => "official",
        (false, false) => "none",
    }
    .to_string();
    let connection_state = if !auth_status.configured {
        match official {
            Some(meta) if meta.needs_reauth => "needs_reauth",
            Some(_) => "connected",
            None => "unconfigured",
        }
    } else {
        "configured"
    }
    .to_string();

    Ok(AppStatus {
        configured: auth_status.configured,
        auth_state,
        connection_state,
        data_source,
        masked_user_id: auth_status.user_id.as_deref().map(mask_user_id),
        region_host: auth_status.region_host,
        last_sync: last_cloud_sync_at.clone(),
        last_cloud_sync_at,
        last_cloud_sync_outcome,
        streams: stream_views(&statuses, &freshness),
        capabilities: capability_views(&statuses),
        database_path: Some(data_dir.join("zepp.db").to_string_lossy().into_owned()),
        retention_days: prefs.retention_days,
        history_sync_days: prefs.history_sync_days,
        incremental_sync_days: zeppbridge_core::contract::INCREMENTAL_SYNC_DAYS,
        auto_sync_days: zeppbridge_core::sync::quick_window_days(full_refresh_due),
        storage: Some(storage),
        coverage,
        region_confidence: "unknown".to_string(),
        compacting: zeppbridge_core::storage::compaction_in_progress(),
        replaying: zeppbridge_core::storage::replay_in_progress(),
    })
}

/// Mesmo formato do `OfficialStatus` do desktop.
#[derive(Serialize)]
pub struct OfficialStatus {
    state: String,
    message_code: Option<String>,
    message: Option<String>,
    user_id_masked: Option<String>,
    nickname: Option<String>,
    connected_at: Option<i64>,
    authorize_url: Option<String>,
}

/// Cópia de `mask` (`src-tauri/src/commands/official.rs`): só os quatro últimos.
fn mask_official(user_id: &str) -> String {
    let tail: String = user_id.chars().rev().take(4).collect::<Vec<_>>().into_iter().rev().collect();
    format!("••••{tail}")
}

pub fn official_status(data_dir: &Path) -> OfficialStatus {
    match OfficialStore::new(data_dir).meta().ok().flatten() {
        Some(meta) => OfficialStatus {
            state: if meta.needs_reauth || meta.is_expired(chrono::Utc::now().timestamp()) {
                "needs_reauth"
            } else {
                "connected"
            }
            .into(),
            message_code: None,
            message: None,
            user_id_masked: Some(mask_official(&meta.user_id)),
            nickname: meta.nickname.clone(),
            connected_at: Some(meta.connected_at),
            authorize_url: None,
        },
        None => OfficialStatus {
            state: "idle".into(),
            message_code: None,
            message: None,
            user_id_masked: None,
            nickname: None,
            connected_at: None,
            authorize_url: None,
        },
    }
}
