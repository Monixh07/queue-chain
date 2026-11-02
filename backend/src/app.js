import http from 'node:http';
import cors from 'cors';
import express from 'express';
import helmet from 'helmet';
import { Server } from 'socket.io';
import { config } from './config.js';
import { api } from './controllers/api.js';
import { assertDatabaseReady } from './database/pool.js';

export function createApplication() {
  const app = express();
  const httpServer = http.createServer(app);
  const io = new Server(httpServer, {
    cors: { origin: config.frontendOrigin, methods: ['GET', 'POST'] },
  });

  app.set('io', io);
  app.use(helmet());
  app.use(cors({ origin: config.frontendOrigin }));
  app.use(express.json({ limit: '20kb' }));
  app.get('/api/admin/setup-status', async (_request, response, next) => {
    try { await assertDatabaseReady(); next(); } catch (error) {
      console.error('Database setup-status check failed:', error);
      response.status(503).json({ error: 'Database service is unavailable.' });
    }
  });
  app.use('/api', api);
  app.use((_request, response) => response.status(404).json({ error: 'Endpoint not found.' }));
  app.use((error, _request, response, _next) => {
    console.error(error);
    response.status(500).json({ error: 'An unexpected server error occurred.' });
  });

  io.on('connection', (socket) => {
    socket.emit('queue:connected');
  });
  return { app, httpServer, io };
}
