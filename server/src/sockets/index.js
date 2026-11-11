import { Server } from 'socket.io';
import { env } from '../config/env.js';
import { logger } from '../config/logger.js';
import { User } from '../models/index.js';
import { verifyAccessToken } from '../services/tokenService.js';
import { isFamilyActive } from '../services/authService.js';
import { loadViewablePost } from '../services/visibility.js';
import { attachIo, markOnline, markOffline } from './realtime.js';
import { announcePresence, relayTyping } from '../services/messageService.js';

const MAX_POST_ROOMS = 60;

export function initSocket(httpServer) {
  const io = new Server(httpServer, {
    cors: { origin: env.CLIENT_URL, credentials: true },
    maxHttpBufferSize: 1e5,
  });
  attachIo(io);

  // Every socket must present a valid access token whose session is still alive.
  io.use(async (socket, next) => {
    try {
      const token = socket.handshake.auth?.token;
      if (!token) return next(new Error('AUTH_REQUIRED'));
      const payload = verifyAccessToken(token);
      if (!(await isFamilyActive(payload.fam))) return next(new Error('SESSION_ENDED'));
      const user = await User.findById(payload.sub).select('status').lean();
      if (!user || user.status !== 'active') return next(new Error('ACCOUNT_UNAVAILABLE'));
      socket.data.userId = payload.sub;
      socket.data.family = payload.fam;
      next();
    } catch {
      next(new Error('AUTH_FAILED'));
    }
  });

  io.on('connection', (socket) => {
    const { userId, family } = socket.data;
    socket.join(`user:${userId}`);
    socket.join(`family:${family}`);
    socket.data.rooms = new Set();
    if (markOnline(userId)) announcePresence(userId, true);
    socket.on('disconnect', () => {
      if (markOffline(userId)) announcePresence(userId, false);
    });

    // typing indicators: tiny, throttled, never acknowledged
    let lastTyping = 0;
    socket.on('typing', (p) => {
      const id = p?.conversationId;
      if (!/^[a-f\d]{24}$/i.test(String(id))) return;
      const now = Date.now();
      if (p.typing) {
        if (now - lastTyping < 800) return; // only "started typing" events are throttled
        lastTyping = now;
      } else lastTyping = 0; // a stop event re-arms the next start
      relayTyping(userId, id, p.typing);
    });

    // Clients subscribe to the posts currently on screen for live counters, comments and polls.
    socket.on('post:join', async (postId, ack) => {
      try {
        if (!/^[a-f\d]{24}$/i.test(String(postId))) return ack?.({ ok: false });
        if (socket.data.rooms.size >= MAX_POST_ROOMS) return ack?.({ ok: false, error: 'TOO_MANY' });
        await loadViewablePost(userId, postId, { lean: true });
        socket.join(`post:${postId}`);
        socket.data.rooms.add(String(postId));
        ack?.({ ok: true });
      } catch {
        ack?.({ ok: false });
      }
    });

    socket.on('post:leave', (postId) => {
      socket.leave(`post:${postId}`);
      socket.data.rooms.delete(String(postId));
    });
  });

  logger.info('Socket.IO ready');
  return io;
}
