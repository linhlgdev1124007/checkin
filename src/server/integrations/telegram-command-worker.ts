import type { TelegramCommandInput, TelegramReactionInput } from '../application/checkin-service.js';
import type { TelegramMessageEntity } from '../domain/telegram-checkin-request.js';

interface TelegramReactionType { type: string; emoji?: string }

export interface TelegramUpdate {
  update_id: number;
  message?: {
    message_id: number;
    date: number;
    text?: string;
    entities?: TelegramMessageEntity[];
    chat: { id: number; type: string };
    from?: { id: number; is_bot: boolean; first_name: string; username?: string };
  };
  message_reaction?: {
    chat: { id: number; type: string };
    message_id: number;
    user?: { id: number; is_bot: boolean; first_name: string; username?: string };
    actor_chat?: { id: number; type: string };
    date: number;
    old_reaction: TelegramReactionType[];
    new_reaction: TelegramReactionType[];
  };
}

export interface TelegramCommandClient {
  getBotUsername(): Promise<string>;
  getUpdates(offset?: number, signal?: AbortSignal): Promise<TelegramUpdate[]>;
  sendReply(chatId: string, text: string, messageId?: number): Promise<void>;
}

interface TelegramCommandService {
  handleTelegramUpdate(input: TelegramCommandInput): Promise<{ processed: boolean; reply: string | null; replyToMessageId?: number | null }>;
  handleTelegramReaction(input: TelegramReactionInput): Promise<{ processed: boolean; reply: string | null; replyToMessageId: number | null }>;
  recordRejectedTelegramUpdate(updateId: number, now?: Date): Promise<void>;
}

export class TelegramCommandWorker {
  private nextOffset: number | undefined;
  private running = false;
  private controller: AbortController | null = null;
  private botUsername: string | null = null;
  private lastUpdateAt: Date | null = null;

  constructor(
    private readonly service: TelegramCommandService,
    private readonly client: TelegramCommandClient,
    private readonly chatId: string,
    private readonly reportError: (error: Error) => void = (error) => console.error('Telegram command worker:', error.message),
    private readonly clock: () => Date = () => new Date(),
  ) {}

  async pollOnce(signal?: AbortSignal): Promise<number> {
    const now = this.clock();
    if (this.lastUpdateAt && now.getTime() - this.lastUpdateAt.getTime() >= 7 * 24 * 60 * 60 * 1_000) this.nextOffset = undefined;
    if (!this.botUsername) this.botUsername = (await this.client.getBotUsername()).replace(/^@/, '');
    const updates = (await this.client.getUpdates(this.nextOffset, signal)).sort((left, right) => left.update_id - right.update_id);
    if (updates.length > 0) this.lastUpdateAt = now;
    let handled = 0;
    for (const update of updates) {
      this.nextOffset = Math.max(this.nextOffset ?? 0, update.update_id + 1);
      const reaction = update.message_reaction;
      if (reaction && String(reaction.chat.id) === this.chatId) {
        handled += 1;
        try {
          const result = await this.service.handleTelegramReaction({
            updateId: update.update_id,
            chatId: String(reaction.chat.id),
            messageId: reaction.message_id,
            userId: reaction.user && !reaction.user.is_bot ? String(reaction.user.id) : null,
            emoji: reaction.new_reaction.flatMap((item) => item.type === 'emoji' && item.emoji ? [item.emoji] : []),
            removed: reaction.old_reaction.length > 0 && reaction.new_reaction.length === 0,
          });
          if (result.reply) await this.client.sendReply(this.chatId, result.reply, result.replyToMessageId ?? reaction.message_id);
        } catch (cause) {
          await this.handleFailure(update.update_id, reaction.message_id, cause, now);
        }
        continue;
      }
      const message = update.message;
      const sender = message?.from;
      const text = message?.text?.trim();
      if (!message || !sender || sender.is_bot || !text?.startsWith('/') || String(message.chat.id) !== this.chatId) continue;
      const addressedBot = /^\/[a-z]+@([A-Za-z0-9_]+)/i.exec(text)?.[1];
      if (addressedBot && addressedBot.toLowerCase() !== this.botUsername.toLowerCase()) continue;
      handled += 1;
      try {
        const result = await this.service.handleTelegramUpdate({
          updateId: update.update_id,
          chatId: String(message.chat.id),
          messageId: message.message_id,
          userId: String(sender.id),
          username: sender.username ?? null,
          text,
          entities: message.entities ?? [],
          sentAt: new Date(message.date * 1_000),
        });
        if (result.reply) await this.client.sendReply(this.chatId, result.reply, result.replyToMessageId ?? message.message_id);
      } catch (cause) {
        await this.handleFailure(update.update_id, message.message_id, cause, now);
      }
    }
    return handled;
  }

  private async handleFailure(updateId: number, messageId: number, cause: unknown, now: Date): Promise<void> {
    const error = asError(cause);
    const reply = error.message === 'SYSTEM_LOCKED'
      ? 'Hệ thống đang khóa. Admin cần mở khóa trên website trước.'
      : 'Bot chưa thể xử lý lệnh lúc này. Vui lòng thử lại sau.';
    if (error.message === 'SYSTEM_LOCKED') await this.service.recordRejectedTelegramUpdate(updateId, now);
    if (error.message !== 'SYSTEM_LOCKED') this.reportError(error);
    await this.client.sendReply(this.chatId, reply, messageId);
  }

  start(): void {
    if (this.running) return;
    this.running = true;
    this.controller = new AbortController();
    void this.loop(this.controller.signal);
  }

  stop(): void {
    this.running = false;
    this.controller?.abort();
    this.controller = null;
  }

  private async loop(signal: AbortSignal): Promise<void> {
    while (this.running && !signal.aborted) {
      try {
        await this.pollOnce(signal);
      } catch (cause) {
        if (signal.aborted) return;
        this.reportError(asError(cause));
        await delay(2_000);
      }
    }
  }
}

export function createTelegramCommandClient(botToken: string): TelegramCommandClient {
  const endpoint = `https://api.telegram.org/bot${botToken}`;
  return {
    async getBotUsername() {
      const response = await fetch(`${endpoint}/getMe`, { signal: AbortSignal.timeout(10_000) });
      const result = await response.json().catch(() => null) as { ok?: boolean; result?: { username?: string }; description?: string } | null;
      if (!response.ok || !result?.ok || !result.result?.username) throw new Error(result?.description ?? `Telegram HTTP ${response.status}`);
      return result.result.username;
    },
    async getUpdates(offset, signal) {
      const response = await fetch(`${endpoint}/getUpdates`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ offset, timeout: 25, allowed_updates: ['message', 'message_reaction'] }),
        signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(30_000)]) : AbortSignal.timeout(30_000),
      });
      const result = await response.json().catch(() => null) as { ok?: boolean; result?: TelegramUpdate[]; description?: string } | null;
      if (!response.ok || !result?.ok || !Array.isArray(result.result)) throw new Error(result?.description ?? `Telegram HTTP ${response.status}`);
      return result.result;
    },
    async sendReply(chatId, text, messageId) {
      const response = await fetch(`${endpoint}/sendMessage`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          chat_id: chatId,
          text,
          reply_parameters: messageId === undefined ? undefined : { message_id: messageId, allow_sending_without_reply: true },
        }),
        signal: AbortSignal.timeout(10_000),
      });
      const result = await response.json().catch(() => null) as { ok?: boolean; description?: string } | null;
      if (!response.ok || !result?.ok) throw new Error(result?.description ?? `Telegram HTTP ${response.status}`);
    },
  };
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function asError(value: unknown): Error {
  return value instanceof Error ? value : new Error('Telegram command failure');
}
