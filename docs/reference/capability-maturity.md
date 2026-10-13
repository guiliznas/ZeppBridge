# Capability maturity (v3, 2026-09-30)

[简体中文](capability-maturity.zh-CN.md)

> How far each capability is wired through core / desktop / CLI / MCP / local
> REST, whether the task scope (MCP `--scope task`) governs it, which platforms
> it has been verified on, and its known limits.
> Update the row whenever you change a capability. The "verified" column lists
> only what has actually been run, never what is inferred.

## At a glance

| Capability | core | Desktop | CLI | MCP | Local REST | Task scope |
|---|---|---|---|---|---|---|
| Legacy-channel sync / history backfill | ✓ | ✓ manual, automatic, 180 days after first connect | ✓ `sync` | — read-only | — | n/a |
| Official open-platform authorization and pulls | ✓ | ✓ authorization relayed through Cloudflare | ✗ not wired | — read-only | — | n/a |
| Local reprocessing | ✓ | ✓ automatic at startup by revision, manual in Settings | ✓ `reprocess` | — | — | n/a |
| Data export (JSON / CSV / GPX / FIT) | ✓ | ✓ | ✓ `export` | — | — | n/a |
| Hand to AI (single `.md` task bundle) | ✓ | ✓ | ✗ | shares the task definition for task scope | — | it is the source |
| Read-only queries: workouts / metrics / sleep / food / life events / data health | ✓ | ✓ per page | `status` gives an overview only | ✓ 15 tools | partial: `/health`, `/workouts/{id}/series` | MCP only |
| Backup, verify, queued restore | ✓ | ✓ | ✗ | — | — | n/a |
| Life-event logging | ✓ | ✓ read/write | ✗ | ✓ read-only (refused in task scope) | — | refused |
| Training plan drafting / sending to the watch | ✓ | ✓ paste the AI reply, week view, per-day tuning | ✗ | ✓ drafting; publishing needs the user to turn on "Let AI publish directly" | — | refused |
| Account ownership (one account per library) | ✓ | ✓ | ✓ checked before sync | — | — | n/a |

Legend: ✓ wired; ✗ not wired, use the desktop app; — not done by design.

## Task scope (MCP `--scope task`)

This applies only to an MCP server started with `--scope task`. The default
`full-readonly` is not narrowed by task switches, and the local REST API does
not look at tasks at all. The rules are in the "Access scope" section of
[Command line and MCP](cli-and-mcp.md); this table only lists how each tool is
handled:

| Tool | Inside task scope |
|---|---|
| `list_workouts`, `get_workout_insight`, `get_workout_detail` | Only granted workouts; excluded fields never leave (`get_workout_detail` also drops what could be derived back, such as heart-rate zones and stride); insight baselines are recomputed over the granted set |
| `get_workout_series` | Never returns precise tracks; for a workout where the task excluded any field, per-point series are refused entirely |
| `get_metric_series`, `get_metric_records`, `list_sleep_sessions`, `get_sleep_detail` | Clipped to the granted date window; excluded metrics are refused and excluded fields omitted; metrics that fit no category are refused |
| `get_food_data` | Daily intake totals only (counted as body data), no individual food entries |
| `list_available_metrics`, `list_life_events`, `get_data_health` | Whole-library views, refused entirely |
| `get_training_context`, `get_athlete_profile`, `get_training_plan`, `draft_training_plan`, `publish_training_plan` | Cross-category, cross-date or training-plan ledger, refused entirely |

A task with no workouts selected ("the last N days") has a window that ends
today; export and MCP compute it with the same function
(`ai_tasks::coverage::task_window`).

## Platforms

| Platform | Verified as far as |
|---|---|
| Windows 11 | Real daily use (portable `release\ZeppBridge.exe`, the owner's own account and real library); CI checks and the full test suite |
| macOS | CI (run 36687163675, `6ef2767`): format, check, Clippy and all tests pass, and dmg / app.tar.gz build; **never run on a real machine** |
| Linux | Same as macOS; deb / rpm / AppImage / Flatpak / Docker build, and the Docker image has an offline self-check; **never run on a real machine** |

Only real hardware can verify these, and none of them have been: frosted glass
in the macOS / Linux WebViews; dragging a file into an AI chat under Wayland
(the drag plugin uses X11 on Linux); "Show in Explorer" should read "Finder" on
macOS and "File Manager" on Linux. Windows MSI rejects prerelease versions such
as `3.0.0-beta.N`, so beta builds from CI ship NSIS only on Windows.

## Known limits

- **Official open platform**: stress, SpO₂, menstrual data, scales and AFib
  have to be requested separately from Zepp business; long date ranges are
  silently truncated, so pulls are chunked to ≤90 days; official hourly steps
  are incomplete, so the legacy channel's per-minute data stays primary.
- **Official token refresh**: single-flight within a process; it cannot stop
  another process (the CLI) refreshing at the same moment, and across processes
  only compare-before-write-back protects it.
- **Switching accounts**: one `data` folder holds one account; switching means
  closing the app and moving the `data` folder away. When both channels are on
  with different accounts, the official supplementary sync only logs it and
  does not tell the user.
- **Official workout details**: when one is permanently unavailable it is set
  aside and retried later (`7df3252`).
- **Self-update**: `self_update_supported()` is hard-wired off during the beta.
- **Upgrades**: one-way; there is no going back. Returning to 2.x only works
  from the pre-upgrade snapshot, and that snapshot is deleted automatically once
  the library is confirmed intact.
