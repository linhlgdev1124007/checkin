# Witnessed Telegram Check-in Approval

## Goal

Allow a linked member to request a backdated Telegram check-in that becomes effective only after the named witness and a linked administrator both approve the original message with a heart reaction. The workflow must survive application restarts, reject duplicate processing, and leave an encrypted audit trail.

## User flow

A linked member sends one of these commands in the configured Telegram group:

```text
/in @witness 23:00
/in @witness 23:00 23/09/2026
```

The date is optional and defaults to the current Vietnam calendar date. The requested instant must not be in the future and must be no more than 12 hours before the command was sent.

The bot replies to the command message with the parsed check-in time and says that witness and administrator approval are pending. The named witness and any linked administrator approve by adding a heart reaction to the original command message. The approvals can arrive in either order. After the first valid approval, the bot replies to the original message with the remaining requirement. After both approvals, it records the check-in at the requested instant and replies with the result.

The request expires 12 hours after the command message. Removing a reaction does not revoke an approval. Reactions added after completion or expiration have no effect. Users unrelated to the request can react without changing its state.

The existing immediate `/out` behavior remains unchanged. Existing `/in` without a witness remains an immediate check-in for backward compatibility.

## Identity and authorization

`/connect Exact Account Name` may link an active administrator account as well as an active member account. The existing one-Telegram-per-account and one-account-per-Telegram constraints remain.

The request author, witness, and approving administrator must all have linked, active accounts. The witness is identified from the Telegram mention entity and its Telegram user identity, rather than trusting visible text. A standard `@username` mention is resolved against the username stored by `/connect`; a Telegram text mention uses the embedded user ID. A witness without a resolvable linked identity causes the command to be rejected.

The requester cannot witness their own request. The witness and administrator must be different Telegram users. If the named witness is an administrator, that person may approve only the witness role; a different linked administrator must provide the administrator approval.

Only the standard heart reaction is accepted. Emoji variation selector differences are normalized. Anonymous reactions cannot approve because they do not identify the reacting user.

## Persistence and state transitions

The encrypted event ledger gains these event types:

- `TELEGRAM_CHECKIN_REQUESTED`: requester account, witness account, Telegram chat/message IDs, requested instant, and expiration instant.
- `TELEGRAM_CHECKIN_WITNESS_APPROVED`: request message identity and witness account.
- `TELEGRAM_CHECKIN_ADMIN_APPROVED`: request message identity and administrator account.
- `TELEGRAM_CHECKIN_COMPLETED`: request message identity and resulting attendance session ID.
- `TELEGRAM_CHECKIN_EXPIRED`: request message identity.

The current request state is projected from these events. Telegram chat and message identifiers are encrypted inside event payloads. The existing plaintext Telegram update cursor remains operational metadata and applies to both message and reaction updates.

Each update is processed atomically on a cloned state. A reaction update appends at most one approval event. The second required approval appends the approval, normal attendance check-in event, completion event, and Telegram outbox reply in the same repository mutation. A failure such as an overlapping session appends no attendance or approval changes and produces a reply explaining the conflict.

Repeated Telegram updates, repeated reactions, and application restarts are idempotent through the update cursor and projected request state. Approval removal is ignored.

## Telegram integration

Long polling requests both `message` and `message_reaction` in `allowed_updates`. Telegram requires the bot to be an administrator in the group to receive reaction updates. The worker accepts reaction updates only from the configured chat and passes the update ID, message ID, reacting Telegram user ID, and normalized reactions to the service.

All workflow notices use `reply_parameters` with the original command message ID. The bot sends replies for request creation, partial approval, completion, expiration discovered during interaction, invalid syntax, invalid identity, and attendance conflicts.

If the system is locked, the bot cannot decrypt identities or requests. It replies that an administrator must unlock the website. Users must remove and re-add their reaction after unlock if their approval happened while locked.

## Parsing and validation

The parser accepts exactly:

```text
/in <mention> HH:mm
/in <mention> HH:mm DD/MM/YYYY
```

Whitespace can vary. Hours use `00:00` through `23:59`. Dates must be real Vietnam calendar dates. The resulting instant uses `Asia/Ho_Chi_Minh`. The parser rejects extra arguments, unresolved mentions, dates outside the 12-hour lookback, future times, self-witnessing, and inactive or unlinked accounts.

Immediate `/in`, `/out`, `/status`, and `/connect` commands keep their current semantics.

## Testing

Domain and service tests cover date parsing across midnight, the 12-hour boundary, future and invalid dates, linked admin accounts, witness identity resolution, approvals in both orders, unrelated and anonymous reactions, self-witness rejection, distinct witness/admin enforcement, expiration, duplicate updates, reaction removal, restart projection, and atomic rollback on attendance conflicts.

Worker tests cover `allowed_updates`, message entities, reaction update mapping, configured-chat filtering, locked-system replies, and replies targeting the original message. API and existing attendance tests must continue to pass.

## Operational setup

The Telegram bot must be an administrator in the configured group. Privacy mode may remain enabled because commands are addressed to the bot, but disabling privacy remains useful for group operation. Deployment continues using long polling; no webhook is introduced.
