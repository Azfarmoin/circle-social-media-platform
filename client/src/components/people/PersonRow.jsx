import { Link } from 'react-router-dom';
import { Avatar, Verified } from '../ui/index.jsx';
import FriendActions from './FriendActions.jsx';

export default function PersonRow({ user, action, sub, friendState, meta }) {
  return (
    <div className="flex items-center gap-3 py-2">
      <Link to={`/u/${user.username}`} className="flex min-w-0 flex-1 items-center gap-3">
        <Avatar user={user} size={46} />
        <span className="min-w-0">
          <span className="block truncate font-semibold">{user.name} <Verified user={user} /></span>
          <span className="block truncate text-sm text-mute">{sub ?? (meta || (user.bio ? user.bio : `@${user.username}`))}</span>
        </span>
      </Link>
      {action ?? (friendState !== undefined && !user.isMe && <FriendActions size="sm" userId={user._id} initial={friendState} />)}
    </div>
  );
}
