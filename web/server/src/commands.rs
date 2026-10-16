//! Os comandos que o modo web atende.
//!
//! Cada handler replica a linha correspondente de `src-tauri/src/commands/**` (citada no comentário),
//! chamando o mesmo método do `zeppbridge-core`. Allowlist explícita: comando fora do `match` → 404.
//!
//! Argumentos: o Tauri converte os parâmetros snake_case do Rust para camelCase no JS
//! (`sleep_id` ↔ `sleepId`), então os structs de argumentos usam `rename_all = "camelCase"`.
//!
//! Só leitura: toda conexão é `Database::open_read_only`. Nada aqui escreve na biblioteca.

use crate::ipc_error::AppError;
use crate::status;
use chrono::Local;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::path::{Path, PathBuf};
use zeppbridge_core::storage::Database;

pub enum Outcome {
    Ok(Value),
    Err(AppError),
    Unknown,
}

/// Mesmo teto de página do desktop (`commands/data/mod.rs`, `MAX_PAGE_SIZE`).
const MAX_PAGE_SIZE: usize = 500;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct SleepPage {
    items: Vec<zeppbridge_core::models::SleepSession>,
    total: i64,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct WorkoutPage {
    items: Vec<zeppbridge_core::models::Workout>,
    total: i64,
}

/// Mesmo formato de `TrainingPlanState` (`src-tauri/src/commands/training_plan.rs`).
#[derive(Serialize)]
struct TrainingPlanState {
    #[serde(flatten)]
    overview: zeppbridge_core::storage::training_plan::PlanOverview,
    drafts: Vec<zeppbridge_core::storage::training_plan::PlanDraft>,
    ai_may_publish: bool,
}

/// Equivale ao `spawn_independent_read` do desktop: conexão só-leitura própria, fora da thread async.
pub async fn read<T, F>(data_dir: &Path, work: F) -> Result<T, AppError>
where
    T: Send + 'static,
    F: FnOnce(&Database) -> zeppbridge_core::models::error::Result<T> + Send + 'static,
{
    let path = data_dir.join("zepp.db");
    tokio::task::spawn_blocking(move || {
        let db = Database::open_read_only(path)?;
        work(&db)
    })
    .await
    .map_err(|error| AppError::new("err.web.internal", format!("leitura interrompida: {error}")))?
    .map_err(AppError::from)
}

fn to_outcome<T: Serialize>(result: Result<T, AppError>) -> Outcome {
    match result.and_then(|value| {
        serde_json::to_value(value)
            .map_err(|error| AppError::new("err.web.internal", format!("resposta não serializável: {error}")))
    }) {
        Ok(value) => Outcome::Ok(value),
        Err(error) => Outcome::Err(error),
    }
}

const PACKAGE_JSON: &str = include_str!("../../../package.json");

fn app_version() -> String {
    serde_json::from_str::<Value>(PACKAGE_JSON)
        .ok()
        .and_then(|package| package.get("version")?.as_str().map(str::to_string))
        .unwrap_or_else(|| "desconhecida".to_string())
}

/// Desserializa os argumentos de um comando num struct local declarado no próprio braço do `match`.
macro_rules! args {
    ($command:expr, $value:expr, { $($field:ident : $ty:ty),* $(,)? }) => {{
        #[derive(Deserialize)]
        #[serde(rename_all = "camelCase")]
        #[allow(dead_code)]
        struct Args { $($field: $ty),* }
        match serde_json::from_value::<Args>($value) {
            Ok(parsed) => parsed,
            Err(error) => {
                return Outcome::Err(AppError::new(
                    "err.web.bad_args",
                    format!("argumentos inválidos para {}: {error}", $command),
                ))
            }
        }
    }};
}

pub async fn dispatch(data_dir: &Path, command: &str, args: Value) -> Outcome {
    let dir: PathBuf = data_dir.to_path_buf();
    match command {
        // lib.rs: no desktop diz se a inicialização terminou; aqui o servidor só sobe com a biblioteca pronta.
        "app_is_ready" => Outcome::Ok(Value::Bool(true)),
        // @tauri-apps/api/app getVersion(): a versão do app, a mesma do package.json que o desktop empacota.
        "plugin:app|version" => Outcome::Ok(Value::String(app_version())),
        // commands/status.rs
        "get_app_status" => to_outcome(status::build_app_status(&dir).await),
        // commands/official.rs (sem a renovação de token: o modo web não escreve)
        "get_official_status" => to_outcome(Ok::<_, AppError>(status::official_status(&dir))),

        // ---- commands/data/mod.rs ----
        "get_health_overview" => to_outcome(read(&dir, |db| db.get_health_overview()).await),
        "get_capability_overview" => {
            let today = Local::now().date_naive();
            to_outcome(read(&dir, move |db| db.capability_overview(today)).await)
        }
        "get_recent_sleep" => {
            let a = args!(command, args, { limit: usize });
            let limit = a.limit.clamp(1, 500);
            to_outcome(read(&dir, move |db| db.get_recent_sleep_sessions(limit)).await)
        }
        "get_sleep_page" => {
            let a = args!(command, args, { limit: usize, offset: usize });
            let (limit, offset) = (a.limit.clamp(1, MAX_PAGE_SIZE), a.offset);
            to_outcome(
                read(&dir, move |db| {
                    Ok(SleepPage { items: db.sleep_sessions_page(limit, offset)?, total: db.count_sleep_sessions()? })
                })
                .await,
            )
        }
        "get_sleep_detail" => {
            let a = args!(command, args, { sleep_id: String });
            to_outcome(read(&dir, move |db| db.get_sleep_detail(&a.sleep_id)).await)
        }
        "get_recent_workouts" => {
            let a = args!(command, args, { limit: usize });
            let limit = a.limit.clamp(1, 500);
            to_outcome(read(&dir, move |db| db.get_recent_workouts(limit)).await)
        }
        "get_workout_page" => {
            let a = args!(command, args, { limit: usize, offset: usize });
            let (limit, offset) = (a.limit.clamp(1, MAX_PAGE_SIZE), a.offset);
            to_outcome(
                read(&dir, move |db| {
                    Ok(WorkoutPage { items: db.workouts_page(limit, offset)?, total: db.count_workouts()? })
                })
                .await,
            )
        }
        "get_workout_detail" => {
            let a = args!(command, args, { workout_id: String });
            to_outcome(read(&dir, move |db| db.get_workout_detail(&a.workout_id)).await)
        }
        "get_workout_series" => {
            let a = args!(command, args, { workout_id: String });
            to_outcome(read(&dir, move |db| db.get_workout_series(&a.workout_id)).await)
        }
        "get_heart_rate_series" => {
            let a = args!(command, args, { hours: i64 });
            to_outcome(read(&dir, move |db| db.heart_rate_series(a.hours)).await)
        }
        "get_stress_series" => {
            let a = args!(command, args, { hours: i64 });
            to_outcome(read(&dir, move |db| db.stress_series(a.hours)).await)
        }
        "get_metric_series" => {
            let a = args!(command, args, { metrics: Vec<String>, days: i64 });
            to_outcome(read(&dir, move |db| db.metric_series(&a.metrics, a.days)).await)
        }
        "get_metric_baselines" => {
            let a = args!(command, args, { metrics: Vec<String> });
            let today = Local::now().date_naive();
            to_outcome(read(&dir, move |db| db.metric_baselines(&a.metrics, today)).await)
        }
        "get_hourly_steps" => {
            let a = args!(command, args, { start: String, end: String });
            to_outcome(read(&dir, move |db| db.hourly_steps(&a.start, &a.end)).await)
        }
        "get_daily_heart_rate_extremes" => {
            let a = args!(command, args, { days: i64 });
            to_outcome(read(&dir, move |db| db.daily_heart_rate_extremes(a.days)).await)
        }
        "get_training_balance" => {
            let a = args!(command, args, { days: i64 });
            let window = a.days.clamp(1, 1825);
            let end = Local::now().date_naive();
            let start = end - chrono::Duration::days(window - 1);
            to_outcome(read(&dir, move |db| db.training_load_balance(start, end)).await)
        }
        "get_heart_rate_zones" => {
            let a = args!(command, args, { days: i64 });
            to_outcome(read(&dir, move |db| db.heart_rate_zone_options(a.days)).await)
        }
        "get_storage_estimate" => {
            let a = args!(command, args, { days: i64 });
            let storage_dir = dir.clone();
            to_outcome(read(&dir, move |db| db.storage_estimate(a.days, &storage_dir)).await)
        }
        "get_user_prefs" => to_outcome(read(&dir, |db| db.user_prefs()).await),
        "get_workout_insight" => {
            let a = args!(command, args, { workout_id: String });
            to_outcome(read(&dir, move |db| db.workout_insight(&a.workout_id)).await)
        }
        "get_weekly_report" => {
            let now = Local::now();
            to_outcome(read(&dir, move |db| db.weekly_report(now)).await)
        }
        "get_data_health" => {
            let a = args!(command, args, { window_days: Option<i64> });
            let database_bytes = std::fs::metadata(dir.join("zepp.db")).map(|meta| meta.len()).unwrap_or(0);
            let window_days = a.window_days.unwrap_or(90);
            to_outcome(read(&dir, move |db| db.data_health(window_days, database_bytes)).await)
        }
        "get_workout_type_options" => to_outcome(Ok::<_, AppError>(zeppbridge_core::sport_catalog::options().to_vec())),
        "get_unknown_workout_codes" => to_outcome(read(&dir, |db| db.unknown_workout_code_labels()).await),

        // ---- commands/training_plan.rs ----
        "training_plan_state" => to_outcome(
            read(&dir, |db| {
                let today = Local::now().date_naive();
                Ok(TrainingPlanState {
                    overview: db.plan_overview(today)?,
                    drafts: db.open_plan_drafts()?,
                    ai_may_publish: db.ai_may_publish_plans()?,
                })
            })
            .await,
        ),
        // ---- commands/life_events.rs ----
        "list_life_events" => {
            let a = args!(command, args, { start: Option<String>, end: Option<String> });
            to_outcome(read(&dir, move |db| db.list_life_events(a.start.as_deref(), a.end.as_deref())).await)
        }
        // ---- commands/ai_tasks.rs ----
        "card_collection_get" => to_outcome(read(&dir, |db| db.card_collection()).await),

        "ai_task_list" => to_outcome(read(&dir, |db| db.list_ai_tasks()).await),
        // ---- commands/data/device_profiles.rs (só leitura; ver devices.rs) ----
        "get_device_profiles" => {
            let a = args!(command, args, { refresh: Option<bool> });
            to_outcome(crate::devices::get_device_profiles(&dir, a.refresh.unwrap_or(false)).await)
        }
        "get_device_profile" => {
            let a = args!(command, args, { device_id: Option<String>, source_scope: Option<String> });
            to_outcome(crate::devices::get_device_profile(&dir, a.device_id.as_deref(), a.source_scope.as_deref()).await)
        }
        // ---- commands/sync.rs ----
        "get_coverage_ledger" => to_outcome(read(&dir, |db| db.coverage_ledger()).await),
        // Plano A: o modo web não sincroniza. O front tenta um sync ao abrir; a mensagem diz onde ele roda.
        "start_incremental_sync" | "start_history_sync" | "start_history_backfill" | "retry_failed_backfill_chunks" => {
            Outcome::Err(AppError::new(
                "err.web.sync_elsewhere",
                "O modo web só lê a biblioteca: a sincronização roda no app desktop ou no `zeppbridge-cli sync`.",
            ))
        }
        "cancel_sync" => Outcome::Ok(Value::Null),
        // ---- commands/backup.rs ----
        "list_backups" => to_outcome(zeppbridge_core::storage::backup::list_backups(&dir).map_err(AppError::from)),
        "get_pending_restore" => to_outcome(Ok::<_, AppError>(zeppbridge_core::storage::backup::pending_restore(&dir))),

        // ---- respostas de "não existe no navegador", no formato que o front já trata ----
        // local_api.rs / commands/ai_clients.rs: API local e sidecar MCP pertencem ao processo desktop.
        "get_local_api_status" | "get_mcp_sidecar" => Outcome::Err(AppError::new(
            "err.web.desktop_only",
            "Disponível só no app desktop.",
        )),
        // commands/login/mod.rs: estado do login legado por WebView, que o modo web não tem.
        "get_login_status" => to_outcome(Ok::<_, AppError>(crate::ipc_types::LoginStatus::idle())),
        // lib.rs: rótulos do menu da bandeja; sem bandeja, nada a fazer.
        "set_tray_locale" => Outcome::Ok(Value::Null),
        // updates/silent.rs: a fase `unsupported` é a mesma que o desktop usa em builds sem auto-update.
        "update_view" | "update_start" => Outcome::Ok(serde_json::json!({
            "phase": "unsupported", "version": null, "notes": null, "date": null,
            "downloaded": 0, "total": null, "waiting_for_sync": false, "portable": false, "error_code": null
        })),

        _ => Outcome::Unknown,
    }
}
