# Check-in System Design

Internal Vietnamese check-in application for one administrator and team members. Each account authenticates with a generated one-time-displayed key. The administrator key also unwraps the database encryption key after each application restart and encrypts portable backups.

The application is a React/Tailwind SPA served by an Express TypeScript server. All APIs live below `/api`; PostgreSQL stores credentials, encrypted records, an append-only integrity chain, sessions, and a Telegram outbox. Caddy terminates HTTP/HTTPS. Docker Compose runs the complete stack.

The first visitor creates the sole administrator. Every restart locks business data until that administrator enters the key. Member account deletion is reversible deactivation. Attendance corrections append an audited correction rather than replacing original check-in events. Every member can see the accumulated team leaderboard.

Business payloads use AES-256-GCM. Login secrets use Argon2id. The data key is wrapped by an Argon2id-derived key from the administrator key and exists in plaintext only in process memory. HMAC-chained events detect record modification or reordering. This does not protect against a VPS owner deleting or rolling back the entire database and all backups.

Check-in and checkout atomically enqueue Telegram messages. Delivery retries asynchronously. A portable encrypted backup can be exported and restored through the administrator UI; a failed validation must leave current data unchanged.

