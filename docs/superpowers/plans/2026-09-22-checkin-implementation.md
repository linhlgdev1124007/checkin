# Check-in System Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Deliver the encrypted, Docker-deployable internal check-in system described in the design spec.

**Architecture:** React/Vite SPA and Express API in one Node process, backed by PostgreSQL. A process-memory vault decrypts application payloads after an administrator unlock. Append-only events drive attendance totals and the Telegram outbox.

**Tech Stack:** TypeScript, React, Tailwind, Express, PostgreSQL, Drizzle schema, Vitest, Docker Compose, Caddy.

**Spec:** `docs/superpowers/specs/2026-09-22-checkin-design.md`

## Tasks

1. Scaffold tooling and implement key, encryption, duration, and attendance domain primitives with TDD.
2. Add PostgreSQL schema, repositories, vault lifecycle, authentication, account management, attendance, audit, backup, and Telegram outbox APIs with tests.
3. Build the responsive React setup, unlock, login, dashboard, member management, audit, correction, Telegram, and backup UI.
4. Add Docker/Caddy deployment assets, operational documentation, production checks, and end-to-end verification.

## Review Focus

- Concurrent first setup or check-in requests must not create duplicate privileged or open-session state.
- Wrong keys and modified ciphertext/backups must fail without exposing plaintext or changing stored data.
- Disabled or rotated credentials and stale sessions must stop working immediately.
- Attendance correction must preserve original events and reject negative, future, or overlapping sessions.
- Telegram failure must never roll back check-in data and must not duplicate a successful delivery.

