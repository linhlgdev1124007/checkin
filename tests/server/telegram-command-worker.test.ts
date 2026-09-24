import { describe, expect, it, vi } from 'vitest';
import { createTelegramCommandClient, TelegramCommandWorker, type TelegramCommandClient } from '../../src/server/integrations/telegram-command-worker.js';

describe('TelegramCommandWorker', () => {
  it('processes commands only from the configured group and advances the polling offset', async () => {
    const offsets: Array<number | undefined> = [];
    const replies: Array<{ chatId: string; text: string; messageId: number }> = [];
    const batches = [[
      update(20, '-999', 'other', '/in'),
      update(21, '-100123', 'Nguyễn An', '/connect Nguyễn An', 'nguyenan'),
    ], []];
    const client: TelegramCommandClient = {
      getBotUsername: async () => 'B6Teams_bot',
      getUpdates: async (offset) => { offsets.push(offset); return batches.shift() ?? []; },
      sendReply: async (chatId, text, messageId) => { replies.push({ chatId, text, messageId: messageId ?? -1 }); },
    };
    const handled: unknown[] = [];
    const service = {
      handleTelegramUpdate: async (input: unknown) => { handled.push(input); return { processed: true, reply: 'Đã kết nối.' }; },
      handleTelegramReaction: async () => ({ processed: true, reply: null, replyToMessageId: null }),
      recordRejectedTelegramUpdate: async () => undefined,
    };
    const worker = new TelegramCommandWorker(service, client, '-100123');

    expect(await worker.pollOnce()).toBe(1);
    expect(await worker.pollOnce()).toBe(0);
    expect(offsets).toEqual([undefined, 22]);
    expect(handled).toEqual([{ updateId: 21, chatId: '-100123', messageId: 121, userId: '42', username: 'nguyenan', text: '/connect Nguyễn An', entities: [], sentAt: new Date(1_795_000_000_000) }]);
    expect(replies).toEqual([{ chatId: '-100123', text: 'Đã kết nối.', messageId: 121 }]);
  });

  it('ignores bot messages, non-command text, and commands addressed to another bot', async () => {
    const client: TelegramCommandClient = {
      getBotUsername: async () => 'B6Teams_bot',
      getUpdates: async () => [
        update(30, '-100123', 'Bot', '/in', 'otherbot', true),
        update(31, '-100123', 'User', 'xin chào'),
        update(32, '-100123', 'User', '/in@AnotherBot'),
        update(33, '-100123', 'User', '/in@B6Teams_bot'),
      ],
      sendReply: async () => undefined,
    };
    let calls = 0;
    const worker = new TelegramCommandWorker({ handleTelegramUpdate: async () => { calls += 1; return { processed: true, reply: null }; }, handleTelegramReaction: async () => ({ processed: true, reply: null, replyToMessageId: null }), recordRejectedTelegramUpdate: async () => undefined }, client, '-100123');
    expect(await worker.pollOnce()).toBe(1);
    expect(calls).toBe(1);
  });

  it('replies when the system is locked without crashing the polling cycle', async () => {
    const replies: string[] = [];
    const rejected: number[] = [];
    const client: TelegramCommandClient = {
      getBotUsername: async () => 'B6Teams_bot',
      getUpdates: async () => [update(40, '-100123', 'Nguyễn An', '/in')],
      sendReply: async (_chatId, text) => { replies.push(text); },
    };
    const worker = new TelegramCommandWorker({ handleTelegramUpdate: async () => { throw new Error('SYSTEM_LOCKED'); }, handleTelegramReaction: async () => { throw new Error('SYSTEM_LOCKED'); }, recordRejectedTelegramUpdate: async (id) => { rejected.push(id); } }, client, '-100123');
    await expect(worker.pollOnce()).resolves.toBe(1);
    expect(replies).toEqual(['Hệ thống đang khóa. Admin cần mở khóa trên website trước.']);
    expect(rejected).toEqual([40]);
  });

  it('drops its in-memory offset after a week without updates', async () => {
    let now = new Date('2026-09-01T00:00:00.000Z');
    const offsets: Array<number | undefined> = [];
    const batches = [[update(1_000, '-100123', 'User', '/status')], [update(5, '-100123', 'User', '/status')]];
    const client: TelegramCommandClient = {
      getBotUsername: async () => 'B6Teams_bot',
      getUpdates: async (offset) => { offsets.push(offset); return batches.shift() ?? []; },
      sendReply: async () => undefined,
    };
    const service = { handleTelegramUpdate: async () => ({ processed: true, reply: null }), handleTelegramReaction: async () => ({ processed: true, reply: null, replyToMessageId: null }), recordRejectedTelegramUpdate: async () => undefined };
    const worker = new TelegramCommandWorker(service, client, '-100123', undefined, () => now);
    await worker.pollOnce();
    now = new Date('2026-09-08T00:00:01.000Z');
    await worker.pollOnce();
    expect(offsets).toEqual([undefined, undefined]);
  });

  it('forwards heart reactions and replies to the original request message', async () => {
    const reactions: unknown[] = [];
    const replies: Array<{ text: string; messageId?: number }> = [];
    const client: TelegramCommandClient = {
      getBotUsername: async () => 'B6Teams_bot',
      getUpdates: async () => [{
        update_id: 60,
        message_reaction: {
          chat: { id: -100123, type: 'supergroup' }, message_id: 444,
          user: { id: 88, is_bot: false, first_name: 'Witness', username: 'witness' },
          old_reaction: [], new_reaction: [{ type: 'emoji', emoji: '❤' }], date: 1_795_000_000,
        },
      }],
      sendReply: async (_chatId, text, messageId) => { replies.push({ text, messageId }); },
    };
    const service = {
      handleTelegramUpdate: async () => ({ processed: true, reply: null }),
      handleTelegramReaction: async (input: unknown) => { reactions.push(input); return { processed: true, reply: 'Đã duyệt.', replyToMessageId: 444 }; },
      recordRejectedTelegramUpdate: async () => undefined,
    };
    const worker = new TelegramCommandWorker(service, client, '-100123');
    expect(await worker.pollOnce()).toBe(1);
    expect(reactions).toEqual([{ updateId: 60, chatId: '-100123', messageId: 444, userId: '88', emoji: ['❤'], removed: false }]);
    expect(replies).toEqual([{ text: 'Đã duyệt.', messageId: 444 }]);
  });

  it('subscribes long polling to messages and reactions', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({ ok: true, result: [] }), { status: 200 }));
    await createTelegramCommandClient('token').getUpdates();
    expect(JSON.parse(String(fetchMock.mock.calls[0][1]?.body))).toMatchObject({ allowed_updates: ['message', 'message_reaction'] });
    fetchMock.mockRestore();
  });
});

function update(updateId: number, chatId: string, firstName: string, text: string, username?: string, isBot = false) {
  return {
    update_id: updateId,
    message: {
      message_id: updateId + 100,
      date: 1_795_000_000,
      chat: { id: Number(chatId), type: 'supergroup' },
      from: { id: 42, is_bot: isBot, first_name: firstName, username },
      text,
    },
  };
}
