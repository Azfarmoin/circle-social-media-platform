import { io } from 'socket.io-client';

let socket = null;
const joined = new Map(); // postId -> subscriber count

// Realtime rides on a long-lived WebSocket connection. Serverless hosts (Netlify Functions)
// cannot hold one, so builds there set VITE_REALTIME=false: every feature still works, live
// updates just need a refresh instead of arriving instantly.
const realtime = import.meta.env.VITE_REALTIME !== 'false';

// Drop-in stand-in with the interface Realtime.jsx and the chat pages rely on.
const offlineStub = () => ({ connected: false, on() {}, emit() {}, disconnect() {}, removeAllListeners() {} });

export function connectSocket(token) {
  disconnectSocket();
  socket = realtime ? io('/', { auth: { token }, transports: ['websocket', 'polling'], reconnectionDelayMax: 8000 }) : offlineStub();
  socket.on('connect', () => joined.forEach((_n, id) => socket.emit('post:join', id)));
  return socket;
}

export function disconnectSocket() {
  if (socket) {
    socket.removeAllListeners();
    socket.disconnect();
    socket = null;
  }
}

export const getSocket = () => socket;

// Reference-counted subscriptions so two cards for the same post share one room.
export function watchPost(id) {
  joined.set(id, (joined.get(id) || 0) + 1);
  if (socket?.connected) socket.emit('post:join', id);
  return () => {
    const n = (joined.get(id) || 1) - 1;
    if (n <= 0) {
      joined.delete(id);
      socket?.emit('post:leave', id);
    } else joined.set(id, n);
  };
}
