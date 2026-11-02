import { Router } from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { timingSafeEqual } from 'node:crypto';
import rateLimit from 'express-rate-limit';
import { z } from 'zod';
import { config } from '../config.js';
import { pool } from '../database/pool.js';
import { requireAdmin } from '../middleware/auth.js';
import * as queue from '../services/queue.js';

export const api = Router();

const bookingSchema = z.object({
  requestId: z.string().uuid(),
  fullName: z.string().trim().min(2).max(120),
  phone: z.string().trim().regex(/^[+0-9 ()-]{7,20}$/),
  email: z.union([z.string().email().max(254), z.literal('')]).optional(),
  serviceRequired: z.string().trim().min(2).max(100),
});

const sendError = (response, error) => {
  const unavailable = error.code?.startsWith('ER_')
    || ['ECONNREFUSED', 'NETWORK_ERROR', 'SERVER_ERROR', 'TIMEOUT'].includes(error.code)
    || /not configured|not deployed|database connection|blockchain connection/i.test(error.message || '');
  if (unavailable) {
    console.error('Queue operation failed because a required service is unavailable:', error);
    return response.status(503).json({ error: 'A required database or blockchain service is unavailable.' });
  }
  return response.status(400).json({ error: error.message || 'Request failed.' });
};
const getIo = (request) => request.app.get('io');
const validationMessage = (error, fallback) => {
  const field = error.issues[0]?.path?.[0];
  const messages = {
    requestId: 'A valid booking request ID is required.',
    fullName: 'Enter a full name between 2 and 120 characters.',
    phone: 'Enter a valid phone number.',
    email: 'Enter a valid email address.',
    serviceRequired: 'Select a service.',
  };
  return messages[field] || fallback;
};
const authRateLimit = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  message: { error: 'Too many authentication attempts. Try again later.' },
});

function issueToken(admin) {
  if (!config.jwtSecret || config.jwtSecret.length < 32) throw new Error('JWT_SECRET must be set to a random value of at least 32 characters.');
  const user = { id: admin.id, email: admin.email, name: admin.name, role: 'ADMIN' };
  return { token: jwt.sign(user, config.jwtSecret, { expiresIn: '8h' }), admin: user };
}

api.get('/health', async (_request, response) => {
  try {
    response.json(await queue.health());
  } catch (error) {
    response.status(503).json({ status: 'unavailable', error: error.message });
  }
});

api.post('/bookings', async (request, response) => {
  const parsed = bookingSchema.safeParse(request.body);
  if (!parsed.success) return response.status(400).json({ error: validationMessage(parsed.error, 'Invalid booking details.') });
  try {
    const result = await queue.createBooking(parsed.data, 'ONLINE');
    getIo(request).emit('queue:update');
    return response.status(result.duplicate ? 200 : 201).json(result);
  } catch (error) {
    return sendError(response, error);
  }
});

api.get('/queue/current', async (_request, response) => {
  try { response.json(await queue.getPublicQueue()); } catch (error) { sendError(response, error); }
});
api.get('/queue/upcoming', async (_request, response) => {
  try { response.json({ upcoming: (await queue.getPublicQueue()).upcoming }); } catch (error) { sendError(response, error); }
});
api.post('/queue/verify', async (request, response) => {
  const phone = z.string().trim().regex(/^[+0-9 ()-]{7,20}$/).safeParse(request.body.phone);
  if (!phone.success) return response.status(400).json({ error: 'Enter a valid phone number.' });
  try {
    const result = await queue.verifyCurrent(phone.data);
    getIo(request).emit('queue:update');
    return response.json(result);
  } catch (error) { return sendError(response, error); }
});

api.get('/admin/setup-status', async (_request, response) => {
  try {
    const [[row]] = await pool.query('SELECT COUNT(*) AS count FROM admins');
    response.json({ setupRequired: Number(row.count) === 0 });
  } catch (error) { response.status(503).json({ error: error.message }); }
});

api.post('/admin/setup', authRateLimit, async (request, response) => {
  const input = z.object({
    setupKey: z.string().min(1), name: z.string().trim().min(2).max(120),
    email: z.string().email().max(254), password: z.string().min(12).max(128),
  }).safeParse(request.body);
  if (!input.success) return response.status(400).json({ error: input.error.issues[0]?.message || 'Invalid setup details.' });
  if (!config.setupKey) return response.status(503).json({ error: 'ADMIN_SETUP_KEY is not configured on the server.' });
  const expected = Buffer.from(config.setupKey);
  const supplied = Buffer.from(input.data.setupKey);
  if (expected.length !== supplied.length || !timingSafeEqual(expected, supplied)) return response.status(403).json({ error: 'The setup key is incorrect.' });
  let connection;
  try {
    const passwordHash = await bcrypt.hash(input.data.password, 12);
    connection = await pool.getConnection();
    const [[lock]] = await connection.query(`SELECT GET_LOCK('queuechain_admin_setup', 10) AS acquired`);
    if (Number(lock.acquired) !== 1) return response.status(503).json({ error: 'Administrator setup is busy. Try again shortly.' });
    const [[count]] = await connection.query('SELECT COUNT(*) AS count FROM admins');
    if (Number(count.count) !== 0) return response.status(409).json({ error: 'Administrator setup has already been completed.' });
    const [result] = await connection.query('INSERT INTO admins (name, email, password_hash, role) VALUES (?, ?, ?, ?)',
      [input.data.name, input.data.email.toLowerCase(), passwordHash, 'ADMIN']);
    await connection.query(`INSERT INTO admin_activity (admin_id, action) VALUES (?, 'ADMIN_SETUP')`, [result.insertId]);
    return response.status(201).json(issueToken({ id: result.insertId, name: input.data.name, email: input.data.email.toLowerCase() }));
  } catch (error) { return sendError(response, error); }
  finally {
    if (connection) {
      await connection.query(`SELECT RELEASE_LOCK('queuechain_admin_setup')`);
      connection.release();
    }
  }
});

api.post('/admin/login', authRateLimit, async (request, response) => {
  const input = z.object({ email: z.string().email(), password: z.string().min(1) }).safeParse(request.body);
  if (!input.success) return response.status(400).json({ error: 'Enter a valid email address and password.' });
  try {
    const [rows] = await pool.query('SELECT id, name, email, password_hash AS passwordHash, role FROM admins WHERE email = ? LIMIT 1',
      [input.data.email.toLowerCase()]);
    if (!rows[0] || !(await bcrypt.compare(input.data.password, rows[0].passwordHash))) {
      return response.status(401).json({ error: 'Email or password is incorrect.' });
    }
    await pool.query('UPDATE admins SET last_login_at = UTC_TIMESTAMP() WHERE id = ?', [rows[0].id]);
    await pool.query(`INSERT INTO admin_activity (admin_id, action) VALUES (?, 'ADMIN_LOGIN')`, [rows[0].id]);
    return response.json(issueToken(rows[0]));
  } catch (error) { return sendError(response, error); }
});

api.use('/admin', requireAdmin);

api.post('/admin/bookings', async (request, response) => {
  const parsed = bookingSchema.safeParse(request.body);
  if (!parsed.success) return response.status(400).json({ error: validationMessage(parsed.error, 'Invalid booking details.') });
  try {
    const result = await queue.createBooking(parsed.data, 'OFFLINE', request.admin.id);
    getIo(request).emit('queue:update');
    return response.status(result.duplicate ? 200 : 201).json(result);
  } catch (error) { return sendError(response, error); }
});

api.get('/admin/dashboard', async (_request, response) => {
  try { response.json(await queue.dashboard()); } catch (error) { sendError(response, error); }
});
api.get('/admin/bookings', async (_request, response) => {
  try { response.json({ bookings: (await queue.dashboard()).bookings }); } catch (error) { sendError(response, error); }
});
api.post('/admin/queue/call-next', async (request, response) => {
  try { const result = await queue.callNext(request.admin.id); getIo(request).emit('queue:update'); response.json(result); }
  catch (error) { sendError(response, error); }
});
api.post('/admin/queue/skip', async (request, response) => {
  const parsed = z.object({ reason: z.string().trim().min(3).max(500) }).safeParse(request.body);
  if (!parsed.success) return response.status(400).json({ error: 'A skip reason of at least three characters is required.' });
  try { const result = await queue.skipCurrent(request.admin.id, parsed.data.reason); getIo(request).emit('queue:update'); response.json(result); }
  catch (error) { sendError(response, error); }
});
api.post('/admin/queue/complete', async (request, response) => {
  try { const result = await queue.completeCurrent(request.admin.id); getIo(request).emit('queue:update'); response.json(result); }
  catch (error) { sendError(response, error); }
});
api.get('/admin/blockchain/history', async (_request, response) => {
  try { response.json({ events: await queue.blockchainHistory() }); } catch (error) { sendError(response, error); }
});
