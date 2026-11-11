import { REACTION_META } from '@shared/constants.js';

const name = (n) => n.actor?.name || n.actor?.username || 'Someone';

export function notificationText(n) {
  const who = name(n);
  switch (n.type) {
    case 'friend_request': return `${who} sent you a friend request`;
    case 'friend_accept': return `${who} accepted your friend request`;
    case 'follow': return `${who} started following you`;
    case 'reaction': return `${who} reacted ${REACTION_META[n.meta?.reaction]?.emoji || ''} to your ${n.meta?.targetType === 'comment' ? 'comment' : 'post'}`;
    case 'comment': return `${who} commented on your post`;
    case 'reply': return `${who} replied to your comment`;
    case 'mention': return `${who} mentioned you`;
    case 'tag': return `${who} tagged you in a post`;
    case 'share': return `${who} shared your post`;
    case 'security_alert': return n.meta?.message || 'New sign-in to your account';
    default: return `${who} interacted with you`;
  }
}

export function notificationLink(n) {
  if (n.post) return `/post/${n.post}`;
  if (n.type === 'friend_request') return '/friends';
  if (n.type === 'security_alert') return '/settings/security';
  if (n.actor?.username) return `/u/${n.actor.username}`;
  return '/notifications';
}
