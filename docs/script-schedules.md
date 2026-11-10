# Script schedules

The independent Scheduled runs page (`#/schedules`) manages named plans. Multiple plans can run the same script with different Cron rules, time zones, targets, arguments and retention policies. Each plan has its own stable ID; selecting a script never overwrites another plan.

New schedule opens a settings dialog. Saved plans have inline execution history, edit and delete actions. Editing opens the settings dialog; execution history opens a separate dialog for that plan. The script picker shows the display name once, adding the path only when it differs.

The editor saves a snapshot of the selected target, environment parameters, positional arguments and resolved timeout. Editing a plan never reads or writes the manual run draft. Saved plans keep their script; create another plan to schedule a different script.

## Triggering

Cron uses five fields (`minute hour day-of-month month day-of-week`), an explicit IANA time zone, and standard day-of-month/day-of-week OR semantics. Croner calculates future times, including daylight-saving transitions. The browser time zone is the default for new plans.

The dashboard must be running. Plans survive restarts; missed times are not replayed. A trigger skips submission while that same plan's preceding execution is queued or running. Different plans for one script are independent and use the normal global/per-target queue limits, logs, history and notification preferences. Pausing or deleting a plan does not cancel already submitted work.

## Execution history and retention

Each plan has paginated execution records linking to the existing run details and logs. The execution service records plan ID, plan name and a retention snapshot in the same insert that queues the execution. Manual executions have no plan association.

Retention is configured per plan in days, from 0 to 3650; 0 means keep forever. New plans default to 30 days. A plan's current retention applies to all its completed records and their logs. Retention starts at completion (`finished_at`, or `queued_at` for legacy rows without a completion time). Queued and running records are never pruned. Cleanup runs at startup and hourly, so expiration can lag by up to one cleanup interval while the dashboard is running.

Deleting a plan leaves its execution records in the global run history. Before deletion, its latest retention policy is copied onto its executions; cleanup can still honor that policy afterward. Manual runs continue using the dashboard's `RETENTION_DAYS` default. A global value of 0 does not override a finite policy on a scheduled plan.

## Upgrade and storage

Migration v11 replaces the script-keyed plan table with independent IDs and permits multiple rows per script. Existing plans keep their settings and inherit the previous global retention policy until explicitly saved. The old model only recorded the latest scheduled execution ID; that provable association is migrated. Other old executions remain in the global history rather than being incorrectly attributed to a plan.

`script_schedules` references scripts and targets. Deleting an owner cascades to its plans; soft-deleted scripts never submit. Execution origin IDs intentionally survive plan deletion. Failed submissions expose only a fixed error code, never parameters or transport details.

## API

All routes require the dashboard session when authentication is enabled:

- `GET /api/script-schedules`: list plans.
- `POST /api/script-schedules`: create a plan.
- `GET`, `PUT`, `DELETE /api/script-schedules/:id`: manage an identified plan.
- `GET /api/script-schedules/:id/executions?limit=20&offset=0`: paginated plan history.
- `GET /api/executions?scheduleId=:id`: filter global history, including a deleted plan's surviving records.

Create/update accepts `scriptId`, `name`, `retentionDays`, `cron`, `timeZone`, `enabled`, and the normal execution `input`. The former single-plan `/api/scripts/:id/schedule` routes are removed because a script no longer uniquely identifies a plan.
