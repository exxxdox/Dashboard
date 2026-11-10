# Interactive Terminal Implementation Plan

> For agentic workers: execute with TDD, bounded parallel ownership, then integrated verification and independent review.

**Goal:** Implement the approved full SSH terminal for manual script executions.
**Architecture:** Preserve non-interactive execution. Stage bytes over a non-PTY channel, then run the selected script under PTY; runner owns runtime control handles, routes own connection leases, existing log sequence owns output.
**Tech Stack:** TypeScript, ssh2, Fastify WebSocket, SQLite, React, existing xterm.
**Spec:** docs/script-interactive-terminal-design.md (approved by user).

## Global Constraints

No new terminal dependency. No input persistence. Bilingual accessible UI. Default interactive=false; schedules reject interactive=true. Existing timeout covers upload and execution. Keep AGENTS.md and CLAUDE.md identical. Temporary artifacts under project tmp/.

## Review Focus

- PTY Ctrl+C and cancellation preserve process cleanup.
- Replay must not send terminal automatic replies to a live script.
- Failed staging must never invoke interpreter.
- Disconnected controller cannot continue typing or resize.
- Authentication and same-origin checks apply before upgrading sockets.

### Task 1: Shared contracts and frontend (delegated, exclusive schemas and web ownership)
- [x] Write failing tests for interactive flag roundtrip, schedule refusal at schema boundary, bounded terminal messages, UI control states and replay guard.
- [x] Add optional interactive fields with default behavior false at consumers; extend ClientMessage terminal_claim, terminal_release, terminal_input, terminal_resize. ServerMessage terminal_state uses waiting/available/controlling/busy/closed, optional error string identifier.
- [x] Extend draft conversion, RunPanel and one-click run; RunTerminal input, resize, mobile keys, control acquisition, disconnection and replay guards; bilingual copy.
- [x] Run shared/web tests and typechecks (shared build first).

### Task 2: SSH transport (delegated, exclusive shell.ts and transport ownership)
- [x] Write failing transport and real PTY tests for staging, input, resize, Ctrl+C/D, password echo, cancellation/timeout and child cleanup.
- [x] Add TerminalControl { write(data:string):boolean; resize(cols:number,rows:number):void }, ExecOptions.terminal?: { uploadCommand:string; onReady(control:TerminalControl):void }.
- [x] Add buildInteractiveCommand(BuildCommandInput): BuiltCommand & {uploadCommand:string}; normal command untouched. Stage via non-PTY, then PTY; limit total deadline, bounded 64KiB pending input, fail closed on staging error, cleanup all paths.
- [x] Run shared shell and transport tests, real SSH/PTY verification.

### Task 3: Execution and socket integration (primary agent)
- [x] Write failing tests for migration/default snapshot, schedule rejection, runner runtime handle lifecycle and WebSocket lease/validation/origin behavior.
- [x] Migrate executions.interactive; propagate input, summary and interpreter mode; runner register getTerminal(id), publish terminal_state available/closed.
- [x] Services validate running interactive execution before returning handle; routes lease first claimant and reject input without ready owner/subscription. Release on unsubscribe/error/close/finish. Limit input 16KiB UTF-8, rows/cols 2..500 and WS payload 64KiB; generic errors contain no input. Reject browser cross-origin upgrades independently of auth enabled.
- [x] Run server integration tests, full typecheck/tests/build and browser smoke tests.

### Task 4: Delivery
- [x] Independent code review; fix substantive findings with regression tests.
- [x] Update design to delivered behavior and contributor docs; force-add intended docs because current .gitignore ignores docs/.
- [x] Verify diff, documentation equality and full relevant checks; commit completed logical feature with English message.

Execution authorized by user; no further plan approval required. Shared interface rulings and verification evidence are tracked in tmp/interactive-terminal-progress.md.
