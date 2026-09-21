import cookieParser from 'cookie-parser';
import express, { type Request, type Response } from 'express';
import helmet from 'helmet';
import { rateLimit } from 'express-rate-limit';
import { z } from 'zod';
import path from 'node:path';
import type { CheckinService, Actor } from './application/checkin-service.js';

interface AppOptions { secureCookies?: boolean; expectedOrigin?: string; staticDir?: string }

export function createApp(service: CheckinService, options: AppOptions = {}) {
  const app = express();
  const secureCookies = options.secureCookies ?? process.env.NODE_ENV === 'production';
  app.set('trust proxy', 1);
  app.use(helmet({ contentSecurityPolicy: false }));
  app.use(express.json({ limit: '1mb' }));
  app.use(cookieParser());
  app.use('/api', (request, response, next) => {
    if (!['POST', 'PUT', 'PATCH', 'DELETE'].includes(request.method)) return next();
    const origin = request.get('origin');
    const allowed = options.expectedOrigin
      ? origin === options.expectedOrigin
      : !secureCookies && origin ? ['localhost', '127.0.0.1'].includes(new URL(origin).hostname) : origin === `${request.protocol}://${request.get('host')}`;
    if (!allowed) return response.status(403).json(apiError('INVALID_ORIGIN'));
    next();
  });

  const authLimiter = rateLimit({ windowMs: 60_000, limit: 10, standardHeaders: true, legacyHeaders: false });
  const asyncRoute = (handler: (request: Request, response: Response) => Promise<unknown>) =>
    (request: Request, response: Response, next: (error?: unknown) => void) => { void handler(request, response).catch(next); };
  const setSession = (response: Response, token: string) => response.cookie('checkin_session', token, {
    httpOnly: true, secure: secureCookies, sameSite: 'strict', maxAge: 7 * 24 * 60 * 60 * 1_000, path: '/',
  });
  const actor = (request: Request): Promise<Actor> => service.authenticate(request.cookies.checkin_session ?? '');

  app.get('/api/health', (_request, response) => response.json({ ok: true }));
  app.get('/api/system/status', asyncRoute(async (_request, response) => response.json(await service.status())));
  app.post('/api/setup', authLimiter, asyncRoute(async (request, response) => {
    const input = z.object({ name: z.string() }).parse(request.body);
    const result = await service.setup(input.name);
    setSession(response, result.token).status(201).json({ key: result.key, account: result.account });
  }));
  app.post('/api/system/unlock', authLimiter, asyncRoute(async (request, response) => {
    const { key } = z.object({ key: z.string() }).parse(request.body);
    const result = await service.unlock(key);
    setSession(response, result.token).json({ account: result.account });
  }));
  app.post('/api/auth/login', authLimiter, asyncRoute(async (request, response) => {
    const { key } = z.object({ key: z.string() }).parse(request.body);
    const result = await service.login(key);
    setSession(response, result.token).json({ account: result.account });
  }));
  app.post('/api/auth/logout', asyncRoute(async (request, response) => {
    if (request.cookies.checkin_session) await service.logout(request.cookies.checkin_session);
    response.clearCookie('checkin_session', { path: '/' }).status(204).end();
  }));
  app.get('/api/auth/session', asyncRoute(async (request, response) => response.json({ account: await actor(request) })));
  app.post('/api/system/lock', asyncRoute(async (request, response) => {
    await service.lock(await actor(request));
    response.clearCookie('checkin_session', { path: '/' }).status(204).end();
  }));

  app.get('/api/accounts', asyncRoute(async (request, response) => response.json({ accounts: await service.listAccounts(await actor(request)) })));
  app.post('/api/accounts', asyncRoute(async (request, response) => {
    const { name } = z.object({ name: z.string() }).parse(request.body);
    response.status(201).json(await service.createAccount(await actor(request), name));
  }));
  app.patch('/api/accounts/:id', asyncRoute(async (request, response) => {
    const input = z.object({ name: z.string().optional(), active: z.boolean().optional() }).parse(request.body);
    await service.updateAccount(await actor(request), routeParam(request.params.id), input);
    response.status(204).end();
  }));
  app.delete('/api/accounts/:id', asyncRoute(async (request, response) => {
    await service.updateAccount(await actor(request), routeParam(request.params.id), { active: false });
    response.status(204).end();
  }));
  app.post('/api/accounts/:id/rotate-key', asyncRoute(async (request, response) => response.json(await service.rotateMemberKey(await actor(request), routeParam(request.params.id)))));

  app.get('/api/dashboard', asyncRoute(async (request, response) => response.json(await service.dashboard(await actor(request)))));
  app.post('/api/attendance/check-in', asyncRoute(async (request, response) => response.status(201).json(await service.checkIn(await actor(request)))));
  app.post('/api/attendance/check-out', asyncRoute(async (request, response) => response.status(201).json(await service.checkOut(await actor(request)))));
  app.post('/api/admin/attendance/:accountId/:sessionId/corrections', asyncRoute(async (request, response) => {
    const input = z.object({ startAt: z.string().datetime(), endAt: z.string().datetime().nullable(), reason: z.string().min(1) }).parse(request.body);
    await service.correctAttendance(await actor(request), routeParam(request.params.accountId), routeParam(request.params.sessionId), input);
    response.status(201).json({ ok: true });
  }));
  app.get('/api/admin/audit', asyncRoute(async (request, response) => response.json({ events: await service.audit(await actor(request)) })));
  app.get('/api/admin/telegram-outbox', asyncRoute(async (request, response) => response.json({ items: await service.listOutbox(await actor(request)) })));
  app.post('/api/admin/telegram-outbox/:id/retry', asyncRoute(async (request, response) => {
    await service.retryOutbox(await actor(request), routeParam(request.params.id));
    response.status(204).end();
  }));
  app.post('/api/admin/backups/export', asyncRoute(async (request, response) => {
    const { key } = z.object({ key: z.string() }).parse(request.body);
    const backup = await service.exportBackup(await actor(request), key);
    response.type('application/json').setHeader('Content-Disposition', 'attachment; filename="team-checkin-backup.json"').send(backup);
  }));
  app.post('/api/admin/backups/import', asyncRoute(async (request, response) => {
    const { key, backup } = z.object({ key: z.string(), backup: z.string().max(25_000_000) }).parse(request.body);
    await service.importBackup(await actor(request), key, backup);
    response.status(204).end();
  }));
  app.post('/api/restore', authLimiter, asyncRoute(async (request, response) => {
    const { key, backup } = z.object({ key: z.string(), backup: z.string().max(25_000_000) }).parse(request.body);
    await service.restoreIntoEmpty(key, backup);
    response.status(204).end();
  }));

  if (options.staticDir) {
    app.use(express.static(options.staticDir, { index: false }));
    app.get(/^(?!\/api(?:\/|$)).*/, (_request, response) => response.sendFile(path.join(options.staticDir!, 'index.html')));
  }

  app.use('/api', (_request, response) => response.status(404).json(apiError('NOT_FOUND')));
  app.use((error: unknown, _request: Request, response: Response, _next: unknown) => {
    const code = error instanceof z.ZodError ? 'INVALID_INPUT' : error instanceof Error ? error.message : 'INTERNAL_ERROR';
    const status = statusFor(code);
    if (status === 500) console.error(error);
    response.status(status).json(apiError(code));
  });
  return app;
}

function apiError(code: string) {
  const messages: Record<string, string> = {
    INVALID_ORIGIN: 'Nguồn yêu cầu không hợp lệ.', INVALID_INPUT: 'Dữ liệu gửi lên không hợp lệ.', INVALID_KEY: 'Key không hợp lệ.',
    SYSTEM_LOCKED: 'Hệ thống đang khóa.', UNAUTHORIZED: 'Phiên đăng nhập không hợp lệ.', FORBIDDEN: 'Bạn không có quyền thực hiện thao tác này.',
    ALREADY_INITIALIZED: 'Hệ thống đã được khởi tạo.', NOT_INITIALIZED: 'Hệ thống chưa được khởi tạo.', ALREADY_CHECKED_IN: 'Bạn đã check in.',
    NOT_CHECKED_IN: 'Bạn chưa check in.', INVALID_BACKUP: 'File backup hoặc key không hợp lệ.',
  };
  return { error: { code, message: messages[code] ?? 'Không thể thực hiện yêu cầu.' } };
}

function statusFor(code: string): number {
  if (code === 'INVALID_INPUT') return 400;
  if (['INVALID_KEY', 'UNAUTHORIZED'].includes(code)) return 401;
  if (['FORBIDDEN', 'INVALID_ORIGIN'].includes(code)) return 403;
  if (['NOT_FOUND', 'ACCOUNT_NOT_FOUND', 'OUTBOX_NOT_FOUND'].includes(code)) return 404;
  if (['ALREADY_INITIALIZED', 'ALREADY_CHECKED_IN', 'NOT_CHECKED_IN', 'ATTENDANCE_OVERLAP'].includes(code)) return 409;
  if (code === 'SYSTEM_LOCKED') return 423;
  if (code.startsWith('INVALID_') || code.endsWith('_REQUIRED') || code === 'ATTENDANCE_IN_FUTURE') return 422;
  return 500;
}

function routeParam(value: string | string[]): string {
  return Array.isArray(value) ? value[0] : value;
}
