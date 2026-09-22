# Telegram Commands and Time Adjustments Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add customizable Telegram messages, audited time adjustments, and Telegram-based member check-in/out.

**Architecture:** Extend the encrypted state and attendance ledger through `CheckinService`; run a long-polling inbound worker beside the existing outbound worker; expose focused admin API and UI controls.

**Tech Stack:** TypeScript, Node.js, Express, React, PostgreSQL JSONB, Telegram Bot API, Vitest.

**Spec:** `docs/superpowers/specs/2026-09-22-telegram-commands-and-adjustments-design.md`

## Global Constraints

- Preserve compatibility with existing schema-version-1 state and encrypted backups.
- Store Telegram identities and templates encrypted with the existing data key; persist the non-secret update cursor while locked to prevent replay.
- Require unique normalized member names and never let an adjustment reduce completed total below zero.
- Process inbound updates only from the configured Telegram group and at most once.

## Review Focus

- Duplicate normalized names must be rejected on create and rename.
- Telegram users and accounts cannot be claimed twice; unlink permits a later reconnect.
- Negative adjustment underflow must not append an event or notification.
- Invalid template placeholders must not be persisted.
- Restarted polling must not replay a processed check-in/out command.

---

### Task 1: Attendance adjustments

**Files:** `src/server/domain/attendance.ts`, `tests/domain/attendance.test.ts`

- [ ] Add failing projection tests for signed adjustment events and underflow.
- [ ] Implement adjustment accumulation and validation.
- [ ] Run the domain tests and commit.

### Task 2: Encrypted service settings and Telegram identity

**Files:** `src/server/data/state-types.ts`, `src/server/application/checkin-service.ts`, `tests/server/checkin-service.test.ts`

- [ ] Add failing service tests for unique names, connect/unlink, templates, adjustments, and command idempotency.
- [ ] Add optional encrypted settings and extended encrypted profiles with lazy defaults.
- [ ] Implement the service APIs and encrypted outbox rendering.
- [ ] Run service tests and commit.

### Task 3: Telegram inbound worker

**Files:** `src/server/integrations/telegram-command-worker.ts`, `src/server/index.ts`, `tests/server/telegram-command-worker.test.ts`

- [ ] Add failing worker tests for group filtering, commands, replies, and cursor progression.
- [ ] Implement Bot API long polling and lifecycle integration.
- [ ] Run worker tests and commit.

### Task 4: Admin API and UI

**Files:** `src/server/app.ts`, `src/client/api.ts`, `src/client/components/Admin.tsx`, `tests/server/app.test.ts`, `tests/client/admin.test.tsx`

- [ ] Add failing API and UI tests for adjustment, unlink, and templates.
- [ ] Implement routes, client methods, linked-account display, adjustment form, and template editor.
- [ ] Run API/client tests and commit.

### Task 5: Operations and deployment

**Files:** `README.md`

- [ ] Document commands, template placeholders, connection rules, and bot group permissions.
- [ ] Run all tests, typecheck, build, audit, and Compose validation.
- [ ] Rebuild Docker, verify health, and exercise Telegram connectivity.
