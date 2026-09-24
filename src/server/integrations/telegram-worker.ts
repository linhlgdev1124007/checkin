export type TelegramSender = (text: string, replyToMessageId?: number) => Promise<void>;
interface OutboxService {
  takeDueOutbox(now?: Date): Promise<{ id: string; text: string; replyToMessageId?: number } | null>;
  finishOutbox(id: string, error: string | null, now?: Date): Promise<void>;
}

export class TelegramWorker {
  private timer: NodeJS.Timeout | null = null;
  private running = false;
  private readonly pendingCompletions = new Map<string, { error: string | null; at: Date }>();

  constructor(
    private readonly service: OutboxService,
    private readonly send: TelegramSender,
    private readonly reportError: (error: Error) => void = (error) => console.error('Telegram worker:', error.message),
  ) {}

  async deliverOnce(now = new Date()): Promise<boolean> {
    try {
      const pending = this.pendingCompletions.entries().next().value as [string, { error: string | null; at: Date }] | undefined;
      if (pending) {
        const [id, completion] = pending;
        await this.service.finishOutbox(id, completion.error, completion.at);
        this.pendingCompletions.delete(id);
        return true;
      }
      const item = await this.service.takeDueOutbox(now);
      if (!item) return false;
      try {
        await this.send(item.text, item.replyToMessageId);
      } catch (error) {
        await this.persistCompletion(item.id, errorMessage(error), now);
        return true;
      }
      await this.persistCompletion(item.id, null, now);
      return true;
    } catch (error) {
      this.reportError(asError(error));
      return false;
    }
  }

  start(intervalMilliseconds = 2_000): void {
    if (this.timer) return;
    this.timer = setInterval(() => {
      if (this.running) return;
      this.running = true;
      void this.deliverOnce().catch((error) => this.reportError(asError(error))).finally(() => { this.running = false; });
    }, intervalMilliseconds);
    this.timer.unref();
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  private async persistCompletion(id: string, error: string | null, now: Date): Promise<void> {
    try {
      await this.service.finishOutbox(id, error, now);
    } catch (cause) {
      this.pendingCompletions.set(id, { error, at: now });
      this.reportError(asError(cause));
    }
  }
}

function asError(value: unknown): Error { return value instanceof Error ? value : new Error('Telegram worker failure'); }
function errorMessage(value: unknown): string { return value instanceof Error ? value.message : 'Telegram delivery failed'; }

export function createTelegramSender(botToken: string, chatId: string): TelegramSender {
  return async (text: string, replyToMessageId?: number) => {
    const response = await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ chat_id: chatId, text, reply_parameters: replyToMessageId === undefined ? undefined : { message_id: replyToMessageId, allow_sending_without_reply: true } }),
      signal: AbortSignal.timeout(10_000),
    });
    const result = await response.json().catch(() => null) as { ok?: boolean; description?: string } | null;
    if (!response.ok || !result?.ok) throw new Error(result?.description ?? `Telegram HTTP ${response.status}`);
  };
}
