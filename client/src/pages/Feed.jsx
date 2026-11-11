import { useEffect, useState } from 'react';
import { useParams, useSearchParams, Link } from 'react-router-dom';
import { useDispatch } from 'react-redux';
import { Newspaper, Compass, Bookmark, Hash, SearchX, FileQuestion } from 'lucide-react';
import { postApi, searchApi } from '../api/index.js';
import { errorMessage } from '../api/http.js';
import { usePostFeed, useTitle, useCurrentUser, useInfinite } from '../lib/hooks.js';
import PostCard from '../components/post/PostCard.jsx';
import Composer from '../components/post/Composer.jsx';
import Sentinel from '../components/ui/Sentinel.jsx';
import { PostSkeleton, Empty, ErrorState, Tabs, Spinner } from '../components/ui/index.jsx';
import { PeopleYouMayKnow, TrendingTags } from '../components/people/Suggestions.jsx';
import PersonRow from '../components/people/PersonRow.jsx';
import { upsertPost } from '../store/slices.js';

export function PostList({ feed, empty, onRemoved }) {
  return (
    <div className="space-y-4">
      {feed.error && <ErrorState message={feed.error} onRetry={feed.reload} />}
      {feed.ids.map((id) => <PostCard key={id} id={id} onRemoved={onRemoved} />)}
      {feed.loading && !feed.ids.length && [0, 1, 2].map((i) => <PostSkeleton key={i} />)}
      {feed.empty && empty}
      <Sentinel loading={feed.loading} done={feed.done} error={feed.error} onMore={feed.loadMore} />
      {feed.done && feed.ids.length > 0 && <p className="py-4 text-center text-sm text-mute">You're all caught up.</p>}
    </div>
  );
}

export function Home() {
  useTitle('Home');
  const me = useCurrentUser();
  const feed = usePostFeed((cursor) => postApi.feed({ cursor, limit: 10 }), []);
  return (
    <div className="flex items-start gap-6">
      <div className="min-w-0 flex-1 space-y-4">
        <Composer onPosted={feed.prepend} />
        <PostList feed={feed} empty={<Empty icon={Newspaper} title="Your feed is quiet" hint="Add some friends or follow people to fill it up — or explore what everyone is posting." action={<Link className="btn-primary mt-2" to="/explore">Explore posts</Link>} />} />
      </div>
      <aside className="sticky top-[4.5rem] hidden w-80 shrink-0 space-y-4 xl:block"><PeopleYouMayKnow /><TrendingTags /></aside>
    </div>
  );
}

export function Explore() {
  useTitle('Explore');
  const [tab, setTab] = useState('explore');
  const feed = usePostFeed((cursor) => (tab === 'trending' ? postApi.trending({ cursor, limit: 10 }) : postApi.explore({ cursor, limit: 10 })), [tab]);
  return (
    <div className="space-y-4">
      <div className="card px-2"><Tabs value={tab} onChange={setTab} tabs={[{ id: 'explore', label: 'Latest public' }, { id: 'trending', label: 'Trending' }]} /></div>
      <PostList feed={feed} empty={<Empty icon={Compass} title="Nothing to explore yet" hint="Public posts will show up here." />} />
    </div>
  );
}

export function Hashtag() {
  const { tag } = useParams();
  useTitle(`#${tag}`);
  const feed = usePostFeed((cursor) => postApi.byHashtag(tag, { cursor, limit: 10 }), [tag]);
  return (
    <div className="space-y-4">
      <div className="card flex items-center gap-3 p-5"><span className="flex h-12 w-12 items-center justify-center rounded-full bg-brand-50 text-brand-600 dark:bg-brand-500/15"><Hash /></span><div><h1 className="text-xl font-bold">#{tag}</h1><p className="text-sm text-mute">Posts you can see with this hashtag</p></div></div>
      <PostList feed={feed} empty={<Empty icon={Hash} title={`No posts with #${tag}`} hint="Be the first to post it." />} />
    </div>
  );
}

export function Saved() {
  useTitle('Saved');
  const [folders, setFolders] = useState(['All']);
  const [folder, setFolder] = useState('All');
  useEffect(() => { postApi.savedCollections().then((r) => setFolders(r.items?.length ? r.items : ['All'])).catch(() => {}); }, []);
  const feed = usePostFeed((cursor) => postApi.saved({ cursor, limit: 10, collection: folder === 'All' ? undefined : folder }), [folder]);
  return (
    <div className="space-y-4">
      <h1 className="text-xl font-bold">Saved posts</h1>
      {folders.length > 1 && <div className="card px-2"><Tabs value={folder} onChange={setFolder} tabs={folders.map((f) => ({ id: f, label: f }))} /></div>}
      <PostList feed={feed} empty={<Empty icon={Bookmark} title="Nothing saved yet" hint="Use the ⋯ menu on any post to save it for later." />} />
    </div>
  );
}

export function PostPage() {
  const { id } = useParams();
  const dispatch = useDispatch();
  const [state, setState] = useState({ loading: true, error: '', status: 0 });
  useTitle('Post');
  useEffect(() => {
    let live = true;
    setState({ loading: true, error: '', status: 0 });
    postApi.get(id).then((p) => { if (live) { dispatch(upsertPost(p)); setState({ loading: false, error: '', status: 200 }); } })
      .catch((e) => live && setState({ loading: false, error: errorMessage(e, 'Could not load this post.'), status: e.response?.status || 0 }));
    return () => { live = false; };
  }, [id, dispatch]);
  if (state.loading) return <PostSkeleton />;
  if (state.error) {
    return state.status === 404 || state.status === 403
      ? <Empty icon={FileQuestion} title="This post isn't available" hint="It may have been deleted, or you may not have permission to see it." action={<Link className="btn-primary mt-2" to="/">Back to home</Link>} />
      : <ErrorState message={state.error} />;
  }
  return <PostCard id={id} expanded />;
}

export function SearchPage() {
  const [params, setParams] = useSearchParams();
  const q = params.get('q') || '';
  const [tab, setTab] = useState('people');
  useTitle(q ? `Search: ${q}` : 'Search');
  const people = useInfinite((cursor) => (q ? searchApi.people({ q, cursor, limit: 15 }) : Promise.resolve({ items: [] })), [q, tab === 'people']);
  const posts = usePostFeed((cursor) => (q ? searchApi.posts({ q, cursor, limit: 10 }) : Promise.resolve({ items: [] })), [q]);
  const [recent, setRecent] = useState([]);
  useEffect(() => { if (!q) searchApi.recent().then((r) => setRecent(r.items || [])).catch(() => {}); }, [q]);

  if (!q) {
    return (
      <div className="space-y-4">
        <h1 className="text-xl font-bold">Search</h1>
        {recent.length > 0 ? (
          <div className="card p-4">
            <div className="mb-2 flex justify-between"><h2 className="font-semibold">Recent searches</h2><button className="text-sm font-semibold text-brand-600" onClick={() => searchApi.clearRecent().then(() => setRecent([]))}>Clear all</button></div>
            <ul>{recent.map((t) => <li key={t}><button className="w-full rounded-lg px-2 py-2 text-left text-sm hover:bg-line/50" onClick={() => setParams({ q: t })}>{t}</button></li>)}</ul>
          </div>
        ) : <Empty icon={SearchX} title="Search Circle" hint="Find people, posts and hashtags using the search box above." />}
        <TrendingTags />
      </div>
    );
  }
  return (
    <div className="space-y-4">
      <h1 className="text-xl font-bold">Results for “{q}”</h1>
      <div className="card px-2"><Tabs value={tab} onChange={setTab} tabs={[{ id: 'people', label: 'People' }, { id: 'posts', label: 'Posts' }]} /></div>
      {tab === 'people' ? (
        <div className="card divide-y divide-line px-4">
          {people.items.map((u) => <PersonRow key={u._id} user={u} sub={u.bio || `@${u.username}`} friendState={u.isFriend ? 'friends' : 'none'} />)}
          {people.loading && <div className="flex justify-center py-6"><Spinner /></div>}
          {people.empty && <p className="py-10 text-center text-sm text-mute">No people found for “{q}”.</p>}
          {people.error && <ErrorState message={people.error} onRetry={people.reload} />}
        </div>
      ) : (
        <PostList feed={posts} empty={<Empty icon={SearchX} title="No posts found" hint="Try different keywords or a #hashtag." />} />
      )}
    </div>
  );
}
