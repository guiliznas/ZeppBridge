//! Perfis de dispositivo: réplica da parte de LEITURA de `src-tauri/src/commands/data/device_profiles.rs`
//! (cache `devices.json` + catálogo embutido + override do usuário + "tem dados locais").
//!
//! Fora: o refresh pela nuvem (`refresh: true`), que escreve `devices.json` e o banco. Pedido de refresh
//! devolve o cache com `refresh_error_code = err.web.read_only`, no mesmo campo que o desktop usa
//! quando o refresh falha.

use crate::commands::read;
use crate::ipc_error::AppError;
use chrono::{DateTime, Utc};
use serde::Deserialize;
use std::collections::HashMap;
use std::path::Path;
use zeppbridge_core::device_catalog::{catalog_entries, match_catalog, CatalogEntry, CatalogMatchInput, CatalogMatchStatus};
use zeppbridge_core::models::{DeviceCacheMetadata, DeviceMatchStatus, DeviceProfile, DeviceProfilesResult};

/// `DEVICE_CACHE_MAX_AGE_SECONDS` em `commands/data/mod.rs`.
const DEVICE_CACHE_MAX_AGE_SECONDS: i64 = 24 * 60 * 60;
const FUSED_SOURCE_NAME: &str = "融合来源";
const UNKNOWN_DEVICE_NAME: &str = "设备未确定";

#[derive(Deserialize)]
struct DeviceProfilesFile {
    cached_at: DateTime<Utc>,
    profiles: Vec<DeviceProfile>,
}

#[derive(Default)]
struct CachedDeviceProfiles {
    profiles: Vec<DeviceProfile>,
    cached_at: Option<DateTime<Utc>>,
}

fn modified_at(path: &Path) -> Option<DateTime<Utc>> {
    let modified = std::fs::metadata(path).ok()?.modified().ok()?;
    Some(DateTime::<Utc>::from(modified))
}

/// `read_device_profile_cache`: os três formatos de `devices.json` e o legado `device.json`.
fn read_device_profile_cache(data_dir: &Path) -> CachedDeviceProfiles {
    let path = data_dir.join("devices.json");
    if let Ok(raw) = std::fs::read_to_string(&path) {
        if let Ok(file) = serde_json::from_str::<DeviceProfilesFile>(&raw) {
            return CachedDeviceProfiles { profiles: file.profiles, cached_at: Some(file.cached_at) };
        }
        if let Ok(list) = serde_json::from_str::<Vec<DeviceProfile>>(&raw) {
            return CachedDeviceProfiles { profiles: list, cached_at: modified_at(&path) };
        }
        if let Ok(single) = serde_json::from_str::<DeviceProfile>(&raw) {
            return CachedDeviceProfiles { profiles: vec![single], cached_at: modified_at(&path) };
        }
    }
    let legacy = data_dir.join("device.json");
    std::fs::read_to_string(&legacy)
        .ok()
        .and_then(|raw| serde_json::from_str::<DeviceProfile>(&raw).ok())
        .map(|profile| CachedDeviceProfiles { profiles: vec![profile], cached_at: modified_at(&legacy) })
        .unwrap_or_default()
}

fn apply_catalog_match(profile: &mut DeviceProfile, entry: &CatalogEntry, status: CatalogMatchStatus) {
    profile.canonical_name = Some(entry.canonical_name.clone());
    profile.catalog_id = Some(entry.canonical_device_key.clone().unwrap_or_else(|| entry.catalog_id.clone()));
    profile.kind = Some(entry.kind.clone());
    profile.image_key = entry.image_key.clone();
    profile.match_status = match status {
        CatalogMatchStatus::Exact => DeviceMatchStatus::Exact,
        CatalogMatchStatus::Alias => DeviceMatchStatus::Alias,
    };
    if profile.display_name.is_none() {
        profile.display_name = profile.name.clone().or_else(|| Some(entry.canonical_name.clone()));
    }
}

fn apply_user_assignment(profile: &mut DeviceProfile, catalog_id: &str) {
    if let Some(entry) = catalog_entries().iter().find(|entry| entry.catalog_id == catalog_id) {
        apply_catalog_match(profile, entry, CatalogMatchStatus::Exact);
        profile.match_status = DeviceMatchStatus::UserAssigned;
    }
}

fn profile_matches(profile: &DeviceProfile, needle: &str) -> bool {
    [&profile.device_id, &profile.serial].into_iter().flatten().any(|value| value.eq_ignore_ascii_case(needle))
}

fn merge_cached_device_profile(mut indexed: DeviceProfile, cached: DeviceProfile) -> DeviceProfile {
    indexed.display_name = indexed.display_name.or(cached.display_name);
    indexed.canonical_name = indexed.canonical_name.or(cached.canonical_name);
    indexed.catalog_id = indexed.catalog_id.or(cached.catalog_id);
    indexed.kind = indexed.kind.or(cached.kind);
    indexed.image_key = indexed.image_key.or(cached.image_key);
    if indexed.match_status == DeviceMatchStatus::Unknown {
        indexed.match_status = cached.match_status;
    }
    indexed.firmware = indexed.firmware.or(cached.firmware);
    indexed.serial = indexed.serial.or(cached.serial);
    indexed.device_id = indexed.device_id.or(cached.device_id);
    indexed.timezone = indexed.timezone.or(cached.timezone);
    indexed
}

fn unknown_device_profile(device_id: &str) -> DeviceProfile {
    let device_id = device_id.trim();
    DeviceProfile {
        name: Some(UNKNOWN_DEVICE_NAME.into()),
        display_name: Some(UNKNOWN_DEVICE_NAME.into()),
        device_id: (!device_id.is_empty()).then(|| device_id.to_string()),
        match_status: DeviceMatchStatus::Unknown,
        ..DeviceProfile::default()
    }
}

/// `enrich_profile_with_local_data`: catálogo, override do usuário e resumo de dados locais.
async fn enrich(
    data_dir: &Path,
    mut profile: DeviceProfile,
    requested_device_id: Option<&str>,
    latest_index: Option<&HashMap<String, String>>,
) -> Result<DeviceProfile, AppError> {
    if profile.display_name.is_none() {
        profile.display_name = profile.name.clone();
    }
    if profile.match_status == DeviceMatchStatus::Unknown {
        let model_codes = profile.device_id.as_deref().into_iter().collect::<Vec<_>>();
        let names = profile.name.as_deref().into_iter().collect::<Vec<_>>();
        if let Some(matched) = match_catalog(&CatalogMatchInput {
            device_source_codes: Vec::new(),
            model_codes,
            product_names: names.clone(),
            device_names: names,
            display_name: profile.display_name.as_deref(),
        }) {
            apply_catalog_match(&mut profile, matched.entry, matched.status);
        }
    }
    let aliases: Vec<String> = [requested_device_id, profile.device_id.as_deref(), profile.serial.as_deref()]
        .into_iter()
        .flatten()
        .map(str::to_string)
        .collect();
    // O usuário indicou o modelo: vale sobre a identificação automática (mesma regra do desktop).
    let keys = aliases.clone();
    let assigned = read(data_dir, move |db| {
        let keys: Vec<&str> = keys.iter().map(String::as_str).collect();
        db.device_model_override(&keys)
    })
    .await?;
    if let Some(assigned) = assigned {
        apply_user_assignment(&mut profile, &assigned.catalog_id);
    }
    let (has_local_data, last_data_at) = match latest_index {
        Some(index) => zeppbridge_core::storage::device_summary_from_index(index, &aliases),
        None => read(data_dir, move |db| db.device_data_summary(&aliases)).await?,
    };
    profile.has_local_data = has_local_data;
    profile.last_data_at = last_data_at;
    Ok(profile)
}

/// `get_device_profiles`, sem refresh pela nuvem.
pub async fn get_device_profiles(data_dir: &Path, refresh: bool) -> Result<DeviceProfilesResult, AppError> {
    let cached = read_device_profile_cache(data_dir);
    let index = read(data_dir, |db| db.device_latest_data_index()).await?;
    let mut profiles = Vec::with_capacity(cached.profiles.len());
    for profile in cached.profiles {
        profiles.push(enrich(data_dir, profile, None, Some(&index)).await?);
    }
    let (refresh_error, refresh_error_code) = if refresh {
        (
            Some("O modo web é somente leitura: atualize a lista de dispositivos pelo app desktop.".to_string()),
            Some("err.web.read_only".to_string()),
        )
    } else {
        (None, None)
    };
    let age_seconds = cached.cached_at.map(|value| (Utc::now() - value).num_seconds().max(0));
    let status = if refresh_error.is_some() {
        if cached.cached_at.is_some() { "refresh_failed" } else { "unavailable" }
    } else if cached.cached_at.is_none() {
        "missing"
    } else if age_seconds.unwrap_or(i64::MAX) > DEVICE_CACHE_MAX_AGE_SECONDS {
        "stale"
    } else {
        "fresh"
    };
    Ok(DeviceProfilesResult {
        profiles,
        cache: DeviceCacheMetadata {
            status: status.to_string(),
            cached_at: cached.cached_at,
            age_seconds,
            refreshed: false,
            refresh_error,
            refresh_error_code,
        },
    })
}

/// `get_device_profile` (`resolve_device_profile`).
pub async fn get_device_profile(
    data_dir: &Path,
    device_id: Option<&str>,
    source_scope: Option<&str>,
) -> Result<DeviceProfile, AppError> {
    let scope_is = |name: &str| source_scope.is_some_and(|scope| scope.eq_ignore_ascii_case(name));
    if scope_is("user_fused") {
        return Ok(DeviceProfile {
            name: Some(FUSED_SOURCE_NAME.into()),
            display_name: Some(FUSED_SOURCE_NAME.into()),
            match_status: DeviceMatchStatus::Unknown,
            ..DeviceProfile::default()
        });
    }
    if scope_is("unknown") {
        return Ok(unknown_device_profile(device_id.unwrap_or("")));
    }
    let Some(device_id) = device_id.map(str::trim).filter(|value| !value.is_empty()) else {
        return Ok(unknown_device_profile(""));
    };
    let lookup_id = device_id.to_string();
    let from_db = read(data_dir, move |db| db.lookup_device_profile(&lookup_id)).await?;
    let cached = read_device_profile_cache(data_dir).profiles.into_iter().find(|profile| profile_matches(profile, device_id));
    match (from_db, cached) {
        (Some(indexed), Some(cached)) => enrich(data_dir, merge_cached_device_profile(indexed, cached), Some(device_id), None).await,
        (Some(indexed), None) => enrich(data_dir, indexed, Some(device_id), None).await,
        (None, Some(cached)) => enrich(data_dir, cached, Some(device_id), None).await,
        (None, None) => Ok(unknown_device_profile(device_id)),
    }
}
