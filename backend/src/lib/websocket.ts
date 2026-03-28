import { Server as HttpServer } from 'http';
import { Server as SocketServer } from 'socket.io';
import jwt from 'jsonwebtoken';
import { redisSub } from '../lib/redis';
import { JwtPayload } from '../lib/types';
import { db } from '../lib/db';

export function initWebSocket(httpServer: HttpServer): SocketServer {
  const io = new SocketServer(httpServer, {
    cors: { origin: '*', methods: ['GET', 'POST'] },
  });

  io.use((socket, next) => {
    const token = socket.handshake.auth?.token || socket.handshake.query?.token;
    if (!token) return next(new Error('Missing token'));
    try {
      const payload = jwt.verify(token as string, process.env.JWT_SECRET || 'secret') as JwtPayload;
      socket.data.user = payload;
      next();
    } catch {
      next(new Error('Invalid token'));
    }
  });

  io.on('connection', async (socket) => {
    const user: JwtPayload = socket.data.user;

    let zoneIds: string[] = user.zoneIds;
    if (user.role === 'supervisor') {
      const result = await db.query('SELECT id FROM zones');
      zoneIds = result.rows.map((r: { id: string }) => r.id);
    }

    for (const zoneId of zoneIds) {
      socket.join(`zone:${zoneId}`);
    }

    socket.emit('connected', { userId: user.userId, zones: zoneIds });
  });

  redisSub.psubscribe('zone:*:sensor_state', (err) => {
    if (err) console.error('[ws] Redis psubscribe error:', err);
    else console.log('[ws] Subscribed to zone sensor state channels');
  });

  redisSub.on('pmessage', (_pattern: string, channel: string, message: string) => {
    const parts = channel.split(':');
    const zoneId = parts[1];
    if (!zoneId) return;

    try {
      const data = JSON.parse(message);
      io.to(`zone:${zoneId}`).emit('sensor_state_change', data);
    } catch {
      console.error('[ws] Failed to parse message:', message);
    }
  });

  return io;
}
