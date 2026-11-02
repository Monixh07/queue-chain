import jwt from 'jsonwebtoken';
import { config } from '../config.js';

export function requireAdmin(request, response, next) {
  const token = request.get('authorization')?.replace(/^Bearer\s+/i, '');
  if (!token) return response.status(401).json({ error: 'Administrator sign-in is required.' });
  if (!config.jwtSecret) return response.status(503).json({ error: 'JWT_SECRET is not configured.' });
  try {
    request.admin = jwt.verify(token, config.jwtSecret);
    if (request.admin.role !== 'ADMIN') return response.status(403).json({ error: 'Administrator permission required.' });
    return next();
  } catch {
    return response.status(401).json({ error: 'The administrator session has expired. Sign in again.' });
  }
}
