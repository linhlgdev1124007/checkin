import type { CheckinService } from '../application/checkin-service.js';

export type TelegramSender = (text: string) => Promise<void>;

export class TelegramWorker {
  private timer: NodeJS.Timeout | null = null;
  private running = false;

  constructor(private readonly service: CheckinService, private readonly send: TelegramSender) {}

  async deliverOnce(now = new Date()): Promise<boolean> {
    const item = await this.service.takeDueOutbox(now);
    if (!item) return false;
    try {
      await this.send(item.text);
      await this.service.finishOutbox(item.id, null, now);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Telegram delivery failed';
      await this.service.finishOutbox(item.id, message, now);
    }
    return true;
  }

  start(intervalMilliseconds = 2_000): void {
    if (this.timer) return;
    this.timer = setInterval(() => {
      if (this.running) return;
      this.running = true;
      void this.deliverOnce().finally(() => { this.running = false; });
    }, intervalMilliseconds);
    this.timer.unref();
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }
}

export function createTelegramSender(botToken: string, chatId: string): TelegramSender {
  return async (text: string) => {
    const response = await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ chat_id: chatId, text }),
      signal: AbortSignal.timeout(10_000),
    });
    const result = await response.json().catch(() => null) as { ok?: boolean; description?: string } | null;
    if (!response.ok || !result?.ok) throw new Error(result?.description ?? `Telegram HTTP ${response.status}`);
  };
}

