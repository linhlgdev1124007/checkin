import path from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { createApp } from './app.js';
import { CheckinService } from './application/checkin-service.js';
import { databaseConfig } from './data/database-config.js';
import { PostgresStateRepository } from './data/state-repository.js';
import { createTelegramCommandClient, TelegramCommandWorker } from './integrations/telegram-command-worker.js';
import { createTelegramSender, TelegramWorker } from './integrations/telegram-worker.js';
import { Vault } from './security/vault.js';

const { Pool } = pg;
const port = Number(process.env.PORT ?? 3000);
const pool = new Pool({ ...databaseConfig(process.env), max: 10 });
const repository = new PostgresStateRepository(pool);
await repository.ensureSchema();
const service = new CheckinService(repository, new Vault());
const currentDirectory = path.dirname(fileURLToPath(import.meta.url));
const staticDir = path.resolve(currentDirectory, '../../client');
const app = createApp(service, {
  secureCookies: process.env.COOKIE_SECURE !== 'false',
  expectedOrigin: process.env.APP_ORIGIN,
  staticDir,
});

let deliveryWorker: TelegramWorker | null = null;
let commandWorker: TelegramCommandWorker | null = null;
if (process.env.TELEGRAM_BOT_TOKEN && process.env.TELEGRAM_CHAT_ID) {
  deliveryWorker = new TelegramWorker(service, createTelegramSender(process.env.TELEGRAM_BOT_TOKEN, process.env.TELEGRAM_CHAT_ID));
  commandWorker = new TelegramCommandWorker(service, createTelegramCommandClient(process.env.TELEGRAM_BOT_TOKEN), process.env.TELEGRAM_CHAT_ID);
  deliveryWorker.start();
  commandWorker.start();
} else {
  console.warn('Telegram delivery disabled: TELEGRAM_BOT_TOKEN or TELEGRAM_CHAT_ID is missing');
}

const server = app.listen(port, () => console.log(`Team Check-in listening on port ${port}`));
const shutdown = () => {
  deliveryWorker?.stop();
  commandWorker?.stop();
  server.close(() => void pool.end().finally(() => process.exit(0)));
  setTimeout(() => process.exit(1), 10_000).unref();
};
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
