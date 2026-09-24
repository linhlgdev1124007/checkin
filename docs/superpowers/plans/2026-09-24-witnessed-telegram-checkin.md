# Witnessed Telegram Check-in Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a restart-safe Telegram `/in @witness HH:mm [DD/MM/YYYY]` workflow that records a backdated check-in only after the linked witness and a distinct linked administrator both react with a heart.

**Architecture:** Parse and validate the request in a focused domain module, persist requests and approvals as encrypted ledger events, and project request state when reaction updates arrive. Extend the existing long-polling worker to consume both messages and reaction updates and always reply to the original command message through the existing outbox/reply mechanism.

**Tech Stack:** TypeScript, Node.js, Express, PostgreSQL state repository, React-independent service/domain tests, Vitest, Telegram Bot API long polling.

**Spec:** `docs/superpowers/specs/2026-09-24-witnessed-telegram-checkin-design.md`

## Global Constraints

- The requested instant is interpreted in `Asia/Ho_Chi_Minh`, cannot be in the future, and cannot be more than 12 hours before the command message.
- A pending request expires 12 hours after the command message.
- Requester, witness, and approving administrator must have distinct linked Telegram identities as specified; requester and witness cannot match, and witness approval cannot also satisfy administrator approval.
- Only `/in` uses approval; immediate `/in`, `/out`, `/status`, and `/connect` retain their current behavior.
- Telegram request and approval data remain encrypted in the ledger; no new plaintext identity data is stored.
- The bot must request `message_reaction` updates and must be a Telegram group administrator.

## Review Focus

- Commands sent near Vietnam midnight must resolve an omitted date to the Vietnam calendar day and still enforce the rolling 12-hour boundary.
- A username mention whose casing changed after `/connect` must resolve case-insensitively, while a username now owned by a different Telegram user must not authorize that user.
- Duplicate, removed, anonymous, custom-emoji, and unrelated reactions must not append approvals or attendance events.
- A second approval racing with another check-in must either complete all related events atomically or persist none of them.
- Restarted workers and Telegram update-ID epoch resets must not repeat a completed check-in or lose the projected pending request.

---

### Task 1: Parse witnessed check-in commands

**Files:**
- Create: `src/server/domain/telegram-checkin-request.ts`
- Create: `tests/server/telegram-checkin-request.test.ts`

**Interfaces:**
- Consumes: Telegram command text, message entities, and the command timestamp.
- Produces: `parseWitnessedCheckIn(input): ParsedWitnessedCheckIn | null`, where the parsed value contains `witness`, `requestedAt`, and `expiresAt`.

- [ ] **Step 1: Write failing parser tests**

Cover `/in @witness 23:00`, `/in @witness 23:00 23/09/2026`, Vietnam midnight, exactly 12 hours ago, 12 hours plus one minute ago, future time, invalid dates/times, extra arguments, and immediate `/in` returning `null`.

```ts
expect(parseWitnessedCheckIn({
  text: '/in @witness 23:00 23/09/2026',
  entities: [{ type: 'mention', offset: 4, length: 8 }],
  now: new Date('2026-09-23T17:00:00.000Z'),
})).toMatchObject({
  witness: { username: 'witness' },
  requestedAt: '2026-09-23T16:00:00.000Z',
  expiresAt: '2026-09-24T05:00:00.000Z',
});
```

- [ ] **Step 2: Run the parser test and confirm RED**

Run: `npm test -- tests/server/telegram-checkin-request.test.ts`

Expected: FAIL because the module and parser do not exist.

- [ ] **Step 3: Implement strict parsing**

```ts
export interface TelegramMessageEntity {
  type: 'mention' | 'text_mention' | string;
  offset: number;
  length: number;
  user?: { id: number; is_bot: boolean; username?: string };
}

export interface ParsedWitnessedCheckIn {
  witness: { userId?: string; username?: string };
  requestedAt: string;
  expiresAt: string;
}

export function parseWitnessedCheckIn(input: {
  text: string;
  entities: TelegramMessageEntity[];
  now: Date;
}): ParsedWitnessedCheckIn | null;
```

Parse real calendar components rather than relying on permissive `Date.parse`, create the instant with Vietnam's fixed `+07:00` offset, compare it to `now`, and throw stable errors `INVALID_WITNESSED_CHECKIN`, `ATTENDANCE_IN_FUTURE`, or `ATTENDANCE_TOO_OLD`.

- [ ] **Step 4: Run parser tests and confirm GREEN**

Run: `npm test -- tests/server/telegram-checkin-request.test.ts`

Expected: all parser tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/server/domain/telegram-checkin-request.ts tests/server/telegram-checkin-request.test.ts
git commit -m "feat: parse witnessed Telegram check-ins"
```

### Task 2: Link Telegram identities to administrator accounts

**Files:**
- Modify: `src/server/application/checkin-service.ts`
- Modify: `tests/server/checkin-service.test.ts`

**Interfaces:**
- Consumes: the existing `/connect Exact Account Name` command.
- Produces: the existing encrypted `AccountProfile.telegram` identity for either an active member or the active administrator.

- [ ] **Step 1: Add a failing administrator-link test**

```ts
expect(await service.handleTelegramUpdate({
  updateId: 10,
  messageId: 50,
  userId: '9001',
  username: 'boss',
  text: '/connect Admin',
  entities: [],
})).toMatchObject({ processed: true, reply: expect.stringContaining('thành công') });
expect((await service.listAccounts(actor)).find((item) => item.role === 'admin'))
  .toMatchObject({ telegramLinked: true, telegramUsername: 'boss' });
```

Also test duplicate Telegram ownership, inactive account rejection, and preserving linkage after an administrator rename.

- [ ] **Step 2: Run the service test and confirm RED**

Run: `npm test -- tests/server/checkin-service.test.ts`

Expected: the admin connection is rejected by the member-only lookup.

- [ ] **Step 3: Generalize the connect lookup**

Replace the member-only lookup in Telegram connection handling with an active-account lookup while preserving name normalization, uniqueness, account integrity checks, encrypted profile writes, and one-to-one Telegram constraints.

- [ ] **Step 4: Run service tests and confirm GREEN**

Run: `npm test -- tests/server/checkin-service.test.ts`

Expected: administrator and existing member connection tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/server/application/checkin-service.ts tests/server/checkin-service.test.ts
git commit -m "feat: link Telegram administrators"
```

### Task 3: Persist requests and process approvals atomically

**Files:**
- Create: `src/server/domain/telegram-approval.ts`
- Create: `tests/server/telegram-approval.test.ts`
- Modify: `src/server/application/checkin-service.ts`
- Modify: `tests/server/checkin-service.test.ts`
- Modify: `src/server/application/ledger.ts` only if event validation enumerates event types.

**Interfaces:**
- Consumes: parsed witnessed commands and `TelegramReactionInput`.
- Produces: projected `TelegramCheckInRequest` state and service results containing a reply plus the original message ID.

- [ ] **Step 1: Add failing projection tests**

```ts
export type TelegramCheckInRequestEvent =
  | { type: 'TELEGRAM_CHECKIN_REQUESTED'; messageId: number; chatId: string; requesterAccountId: string; witnessAccountId: string; requestedAt: string; expiresAt: string }
  | { type: 'TELEGRAM_CHECKIN_WITNESS_APPROVED'; messageId: number; approverAccountId: string }
  | { type: 'TELEGRAM_CHECKIN_ADMIN_APPROVED'; messageId: number; approverAccountId: string }
  | { type: 'TELEGRAM_CHECKIN_COMPLETED'; messageId: number; sessionId: string }
  | { type: 'TELEGRAM_CHECKIN_EXPIRED'; messageId: number };
```

Test pending, either approval order, completion, expiration, duplicate approvals, removal ignored, and isolation of equal message IDs from different chats.

- [ ] **Step 2: Run projection tests and confirm RED**

Run: `npm test -- tests/server/telegram-approval.test.ts`

Expected: FAIL because the projection module does not exist.

- [ ] **Step 3: Implement the pure request projection**

Expose `projectTelegramCheckInRequests(events)` returning a map keyed by `${chatId}:${messageId}` with requester, witness, requested time, expiration, witness approval, administrator approval, and terminal status. Reject internally contradictory histories.

- [ ] **Step 4: Add failing service workflow tests**

Create three linked identities and verify:

```ts
await service.handleTelegramUpdate(commandFromRequester);
expect(await service.handleTelegramReaction(witnessHeart)).toMatchObject({
  processed: true,
  reply: expect.stringContaining('chờ admin'),
  replyToMessageId: commandFromRequester.messageId,
});
expect(await service.handleTelegramReaction(adminHeart)).toMatchObject({
  processed: true,
  reply: expect.stringContaining('Check-in thành công'),
  replyToMessageId: commandFromRequester.messageId,
});
```

Add tests for admin-first order, self-witness, same witness/admin user, unlinked/inactive identities, unrelated heart, non-heart/custom/anonymous/removal reactions, expiry, duplicate update IDs, restart using the same repository, and atomic rollback when the historical check-in overlaps an existing session.

- [ ] **Step 5: Implement service methods and encrypted events**

Extend message input with `chatId`, `messageId`, and `entities`. Add:

```ts
export interface TelegramReactionInput {
  updateId: number;
  chatId: string;
  messageId: number;
  userId: string | null;
  emoji: string[];
  removed: boolean;
  now?: Date;
}

handleTelegramReaction(input: TelegramReactionInput): Promise<{
  processed: boolean;
  reply: string | null;
  replyToMessageId: number | null;
}>;
```

Resolve the requester by Telegram user ID and the witness by mention identity. Append encrypted request/approval events through `appendEvent`. On the second valid approval, call the existing in-state attendance transition using `requestedAt`, then append completion and enqueue/reply in the same cloned-state mutation. Record the Telegram update cursor only with the successful cloned state; on a domain error, persist only the cursor and return a Vietnamese reply.

- [ ] **Step 6: Run projection and service tests and confirm GREEN**

Run: `npm test -- tests/server/telegram-approval.test.ts tests/server/checkin-service.test.ts`

Expected: all request, approval, restart, and existing service tests pass.

- [ ] **Step 7: Commit**

```bash
git add src/server/domain/telegram-approval.ts tests/server/telegram-approval.test.ts src/server/application/checkin-service.ts tests/server/checkin-service.test.ts src/server/application/ledger.ts
git commit -m "feat: approve witnessed Telegram check-ins"
```

### Task 4: Receive Telegram reactions and reply to original messages

**Files:**
- Modify: `src/server/integrations/telegram-command-worker.ts`
- Modify: `tests/server/telegram-command-worker.test.ts`
- Modify: `src/server/index.ts` only if the worker constructor interface changes.

**Interfaces:**
- Consumes: Telegram `message` and `message_reaction` updates from `getUpdates`.
- Produces: command/reaction calls to the service and `sendReply(chatId, text, originalMessageId)`.

- [ ] **Step 1: Add failing worker tests**

Assert that `getUpdates` sends:

```ts
allowed_updates: ['message', 'message_reaction']
```

Test forwarding message entities, chat/message IDs, standard heart addition, reaction removal, anonymous `actor_chat`, other-chat filtering, other-bot command filtering, and replying to the original command message for every workflow state.

- [ ] **Step 2: Run worker tests and confirm RED**

Run: `npm test -- tests/server/telegram-command-worker.test.ts`

Expected: reaction fixtures are ignored and message entities are absent.

- [ ] **Step 3: Extend Telegram update mapping**

Add Telegram Bot API shapes for message entities and `message_reaction`. Keep a single monotonic `nextOffset` across both update types. Normalize the standard heart to one internal value, forward anonymous reactions with `userId: null`, and do not treat bot-generated reactions as approvals.

When the service returns a reply, call `sendReply` with the configured chat ID and the original request message ID. For `SYSTEM_LOCKED`, reply to that same message and record the rejected update through the existing cursor path.

- [ ] **Step 4: Run worker tests and confirm GREEN**

Run: `npm test -- tests/server/telegram-command-worker.test.ts`

Expected: all existing command tests and new reaction tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/server/integrations/telegram-command-worker.ts tests/server/telegram-command-worker.test.ts src/server/index.ts
git commit -m "feat: handle Telegram approval reactions"
```

### Task 5: Document, verify, deploy, and exercise the workflow

**Files:**
- Modify: `README.md`
- Modify: `.env.example` only if a new environment setting is required.

**Interfaces:**
- Consumes: completed feature and existing Docker Compose deployment.
- Produces: operator instructions and a verified running image.

- [ ] **Step 1: Update operator documentation**

Document the exact command forms, 12-hour request and expiry limits, `/connect` for administrators and witnesses, required ❤️ approvals, reply behavior, and the requirement that the bot be a group administrator. State that Bot API polling explicitly subscribes to `message_reaction`.

- [ ] **Step 2: Run complete verification**

Run:

```bash
npm test
npm run build
npm audit
docker compose config --quiet
git diff --check
```

Expected: every command exits zero, all tests pass, and audit reports zero vulnerabilities.

- [ ] **Step 3: Perform final code review**

Review authorization boundaries, encrypted fields, atomic completion, reaction idempotency, expired requests, update cursor behavior, and Telegram reply targeting. Fix every Critical or Important issue and repeat Step 2.

- [ ] **Step 4: Commit documentation and fixes**

```bash
git add README.md .env.example src tests
git commit -m "docs: explain witnessed Telegram check-ins"
git push origin main
```

- [ ] **Step 5: Rebuild and health-check Docker**

Run:

```bash
docker compose up -d --build
docker compose ps
curl http://localhost/api/health
curl http://localhost/api/system/status
docker compose logs --tail=100 app
```

Expected: app and PostgreSQL are healthy, health returns `{"ok":true}`, system status is valid, and logs contain no worker errors.

- [ ] **Step 6: Manual Telegram acceptance test**

After unlocking the website, connect one member, one witness, and one administrator. Send a request within the previous 12 hours, approve in both orders, verify each bot response replies to the original message, and confirm the resulting session appears once in the dashboard and audit log.
