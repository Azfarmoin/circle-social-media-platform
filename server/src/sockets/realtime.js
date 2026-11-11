// Thin singleton so services can emit real-time events without importing socket.io directly.
// When no server is attached (tests, scripts, seed) every call is a safe no-op.
let io = null;

export const attachIo = (instance) => {
  io = instance;
};
export const getIo = () => io;

export const emitToUser = (userId, event, payload) => {
  if (io) io.to(`user:${userId}`).emit(event, payload);
};

export const emitToPost = (postId, event, payload) => {
  if (io) io.to(`post:${postId}`).emit(event, payload);
};

export const disconnectFamily = (family) => {
  if (!io) return;
  io.in(`family:${family}`).emit('session:revoked');
  io.in(`family:${family}`).disconnectSockets(true);
};

export const disconnectUser = (userId) => {
  if (!io) return;
  io.in(`user:${userId}`).emit('session:revoked');
  io.in(`user:${userId}`).disconnectSockets(true);
};

// Which users have at least one live socket. In-memory, so single-instance (see ARCHITECTURE.md).
const online = new Map();
export const markOnline = (userId) => {
  const id = String(userId);
  online.set(id, (online.get(id) || 0) + 1);
  return online.get(id) === 1; // true when this is the first socket
};
export const markOffline = (userId) => {
  const id = String(userId);
  const n = (online.get(id) || 1) - 1;
  if (n <= 0) online.delete(id);
  else online.set(id, n);
  return n <= 0; // true when the last socket went away
};
export const isOnline = (userId) => online.has(String(userId));
