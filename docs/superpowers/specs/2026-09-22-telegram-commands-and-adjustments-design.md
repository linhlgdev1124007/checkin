# Telegram Commands and Time Adjustments Design

## Goal

Let administrators customize Telegram notifications and adjust a member's total time with a reason, while letting members connect a Telegram identity once and then check in, check out, or view status from the group.

## Behavior

- `/connect Nguyễn Văn A` matches an active, unlinked member by normalized name (trimmed, collapsed whitespace, case-insensitive, Vietnamese diacritics preserved) and immediately stores the Telegram user identity.
- Member names are unique under the same normalization. One Telegram user maps to one account and one account maps to one Telegram user. Admin can disconnect a mapping.
- `/in`, `/out`, and `/status` operate only on the account linked to the sending Telegram user.
- The bot consumes updates with long polling, accepts commands only from the configured group, and persists the last processed update ID to prevent replay after restart.
- Admin can add or subtract days, hours, and minutes from a member's all-time completed total. A non-empty reason is required and subtraction cannot make the total negative.
- Adjustments are immutable `ATTENDANCE_ADJUSTED` ledger events. They do not rewrite session events.
- Check-in, check-out, adjustment, and connection notifications use four admin-editable templates with allow-listed placeholders. Invalid templates are rejected. Defaults can be restored.
- Telegram linkage and template settings are encrypted with the data key. The non-secret update cursor is stored as operational system metadata so commands rejected while the vault is locked cannot replay after restart. Existing schema-version-1 state remains readable through optional fields and lazy defaults.

## Components

- `attendance.ts` projects signed adjustments into completed time.
- `CheckinService` owns name uniqueness, Telegram linking/commands, adjustments, templates, encrypted settings, and outbox creation.
- `TelegramCommandWorker` fetches updates and passes normalized commands to the service. The existing `TelegramWorker` continues reliable outbound delivery.
- Express exposes admin endpoints for unlinking, adjustments, and template settings.
- Admin UI shows Telegram linkage, an adjustment form, and template editing with previews/default reset.

## Failure Handling

- Commands from other chats, bots, messages without a sender, and unsupported text are ignored.
- A locked or uninitialized system returns a short Telegram response and advances the update cursor so one update cannot block later commands.
- Domain conflicts return Vietnamese responses without changing attendance.
- Outbound group announcements use the existing encrypted outbox and retry behavior.

## Verification

- Domain tests cover positive/negative adjustments and the zero floor.
- Service tests cover unique names, connect ownership, unlinking, templates, announcements, and idempotent update processing.
- Worker tests cover parsing, group filtering, cursor progression, and command replies.
- API and client tests cover the new admin controls.
