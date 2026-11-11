import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { friendApi, searchApi } from '../../api/index.js';
import PersonRow from './PersonRow.jsx';
import FriendActions from './FriendActions.jsx';
import { Skeleton } from '../ui/index.jsx';

export function PeopleYouMayKnow({ limit = 5 }) {
  const [items, setItems] = useState(null);
  useEffect(() => { friendApi.suggestions(limit).then((r) => setItems(r.items)).catch(() => setItems([])); }, [limit]);
  if (items && !items.length) return null;
  return (
    <section className="card p-4" aria-label="People you may know">
      <h2 className="mb-1 font-bold">People you may know</h2>
      {!items ? <div className="space-y-3 py-2">{[0, 1, 2].map((i) => <Skeleton key={i} className="h-10 w-full" />)}</div> : items.map((u) => (
        <PersonRow key={u._id} user={u} sub={u.mutualCount ? `${u.mutualCount} mutual friends` : `@${u.username}`} action={<FriendActions size="sm" compact userId={u._id} />} />
      ))}
      <Link to="/friends?tab=suggestions" className="mt-1 block text-sm font-semibold text-brand-600 hover:underline">See all</Link>
    </section>
  );
}

export function TrendingTags() {
  const [tags, setTags] = useState(null);
  useEffect(() => { searchApi.trending().then((r) => setTags(r.items)).catch(() => setTags([])); }, []);
  if (tags && !tags.length) return null;
  return (
    <section className="card p-4" aria-label="Trending hashtags">
      <h2 className="mb-2 font-bold">Trending</h2>
      {!tags ? <Skeleton className="h-24 w-full" /> : (
        <ul className="space-y-1">
          {tags.slice(0, 7).map((t) => (
            <li key={t._id}><Link to={`/hashtag/${t.tag}`} className="flex items-baseline justify-between rounded-lg px-2 py-1.5 hover:bg-line/50"><span className="font-semibold">#{t.tag}</span><span className="text-xs text-mute">{t.postCount} posts</span></Link></li>
          ))}
        </ul>
      )}
    </section>
  );
}
