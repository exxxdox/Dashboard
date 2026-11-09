# Script schedules

Each script can have one saved schedule. The run dialog saves a five-field Cron expression (`minute hour day-of-month month day-of-week`), an IANA time zone, an enabled flag, and a snapshot of the selected target, parameters, arguments, and timeout. Changing the run draft later does not change this snapshot. Saving the schedule explicitly replaces it with the current run settings.

The dashboard must be running. Schedules survive restarts, but missed times are not replayed. A trigger skips submission while the preceding scheduled execution is queued or running. Manual runs remain independent. All actual runs use the existing execution service, queue, logs, history, and notifications.

Cron parsing and next-occurrence calculation use Croner, including time zones and daylight-saving transitions. Five fields only; seconds and aliases are not accepted. Cron day-of-month and day-of-week follow standard OR semantics. The browser time zone is the initial default and is saved explicitly.

Storage: `script_schedules`, keyed by script ID; target ID is a foreign key, and the remaining run input is JSON. Deleting a script/source or its target deletes the schedule. Soft-deleted scripts are never submitted. Last execution references become null if history is removed. Submission errors are reported without storing parameters or transport details in the error message.

API: authenticated `GET`, `PUT`, and `DELETE /api/scripts/:id/schedule`. GET returns a schedule or null. PUT validates Cron, time zone, target, and script parameters before saving. The response includes the next trigger, latest trigger, latest execution, and latest submission error. Disabling a schedule does not cancel an already queued/running execution.

Implementation and verification:

1. Add shared request/response contracts and schema v9; test boundary defaults/bounds and migration foreign keys.
2. Add schedule service and routes; test Cron/time zones, saved snapshots, restoration, disable/delete, overlap, missed times, errors, and route authorization.
3. Add a schedule section in the existing run dialog, with bilingual labels, explicit snapshot semantics, status and history link; test API wiring and user interactions.
4. Restore schedules after interrupted runs are reconciled; stop timers before shutdown. Run shared build, type checks, tests, production build, and browser checks.
