import { useEffect } from 'react';
import { useDispatch } from 'react-redux';
import { useNavigate } from 'react-router-dom';
import { connectSocket, disconnectSocket } from '../lib/socket.js';
import { getAccessToken } from '../api/http.js';
import { patchPost, pollUpdate, received, loadUnread, loadChatUnread, signedOut, pushToast } from '../store/slices.js';
import { notificationText } from '../lib/notifications.js';

/** Owns the socket for a signed-in session and funnels server events into the store. */
export default function Realtime({ userId }) {
  const dispatch = useDispatch();
  const navigate = useNavigate();
  useEffect(() => {
    const token = getAccessToken();
    if (!token) return undefined;
    dispatch(loadUnread());
    dispatch(loadChatUnread());
    const s = connectSocket(token);
    s.on('notification', (n) => {
      dispatch(received(n));
      window.dispatchEvent(new CustomEvent('circle:notification', { detail: n }));
      dispatch(pushToast(notificationText(n), 'info'));
    });
    s.on('reaction:update', (p) => {
      if (p.targetType !== 'post') return;
      const changes = { reactionCounts: p.reactionCounts, reactionTotal: p.reactionTotal };
      if (p.actorId === userId) changes.myReaction = p.type;
      dispatch(patchPost({ id: p.postId, changes }));
    });
    s.on('poll:update', (p) => dispatch(pollUpdate(p)));
    s.on('comment:new', (p) => dispatch(patchPost({ id: p.postId, changes: { commentCount: p.commentCount } })));
    s.on('comment:delete', (p) => dispatch(patchPost({ id: p.postId, changes: { commentCount: p.commentCount } })));
    const chat = (event) => (payload) => {
      window.dispatchEvent(new CustomEvent('circle:chat', { detail: { event, payload } }));
      dispatch(loadChatUnread());
    };
    s.on('message:new', (p) => {
      chat('new')(p);
      if (p.from !== userId && !window.location.pathname.startsWith('/messages')) dispatch(pushToast('New message', 'info'));
    });
    s.on('message:read', chat('read'));
    s.on('message:read:self', chat('self'));
    s.on('message:delete', chat('delete'));
    s.on('typing', (p) => window.dispatchEvent(new CustomEvent('circle:chat', { detail: { event: 'typing', payload: p } })));
    s.on('presence', (p) => window.dispatchEvent(new CustomEvent('circle:chat', { detail: { event: 'presence', payload: p } })));
    s.on('session:revoked', () => { dispatch(signedOut()); navigate('/login', { replace: true }); });
    s.on('connect_error', (e) => { if (['SESSION_ENDED', 'ACCOUNT_UNAVAILABLE'].includes(e.message)) dispatch(signedOut()); });
    return disconnectSocket;
  }, [userId, dispatch, navigate]);
  return null;
}
