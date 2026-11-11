import { useCallback, useEffect, useRef, useState } from 'react';
import { useDispatch, useSelector } from 'react-redux';
import { postSelectors, upsertPosts, setTheme, pushToast } from '../store/slices.js';
import { errorMessage } from '../api/http.js';

export const useToast = () => {
  const dispatch = useDispatch();
  return useCallback(
    (message, kind = 'info') => dispatch(pushToast(message, kind)),
    [dispatch]
  );
};

export function useCurrentUser() {
  return useSelector((s) => s.auth.user);
}

/**
 * Cursor pagination. `fetcher(cursor)` returns { items, nextCursor }.
 * Stale responses from an earlier `deps` value are ignored.
 */
export function useInfinite(fetcher, deps = [], { onPage } = {}) {
  const [items, setItems] = useState([]);
  const [cursor, setCursor] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [done, setDone] = useState(false);
  const run = useRef(0);
  const busy = useRef(false);
  const fetchRef = useRef(fetcher);
  fetchRef.current = fetcher;
  const pageRef = useRef(onPage);
  pageRef.current = onPage;

  const load = useCallback(async (from, reset) => {
    if (busy.current && !reset) return;
    busy.current = true;
    const mine = ++run.current;
    setLoading(true);
    setError('');
    try {
      const data = await fetchRef.current(from);
      if (mine !== run.current) return;
      pageRef.current?.(data.items, data);
      setItems((prev) => (reset ? data.items : [...prev, ...data.items.filter((i) => !prev.some((p) => p._id === i._id))]));
      setCursor(data.nextCursor || null);
      setDone(!data.nextCursor);
    } catch (e) {
      if (mine === run.current) setError(errorMessage(e, 'Could not load this list.'));
    } finally {
      if (mine === run.current) {
        setLoading(false);
        busy.current = false;
      }
    }
  }, []);

  useEffect(() => {
    busy.current = false;
    setItems([]);
    setCursor(null);
    setDone(false);
    load(null, true);
    return () => {
      run.current += 1;
      busy.current = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);

  const loadMore = useCallback(() => {
    if (!done && cursor) load(cursor, false);
  }, [done, cursor, load]);
  const reload = useCallback(() => {
    busy.current = false;
    load(null, true);
  }, [load]);

  return { items, setItems, loading, error, done, loadMore, reload, empty: !loading && !error && items.length === 0 };
}

/** Infinite list of posts: the posts live in the store so reactions and sockets update every copy. */
export function usePostFeed(fetcher, deps) {
  const dispatch = useDispatch();
  const list = useInfinite(fetcher, deps, { onPage: (items) => dispatch(upsertPosts(items)) });
  const entities = useSelector(postSelectors.selectEntities);
  const visible = list.items.map((i) => i._id).filter((id) => entities[id]);
  const prepend = useCallback(
    (post) => {
      dispatch(upsertPosts([post]));
      list.setItems((prev) => [post, ...prev.filter((p) => p._id !== post._id)]);
    },
    [dispatch, list]
  );
  return { ...list, ids: visible, prepend, empty: list.empty || (!list.loading && !list.error && visible.length === 0) };
}

/** Calls `onNear` whenever the sentinel scrolls into view. */
export function useSentinel(onNear, enabled = true) {
  const ref = useRef(null);
  const cb = useRef(onNear);
  cb.current = onNear;
  useEffect(() => {
    const el = ref.current;
    if (!el || !enabled || typeof IntersectionObserver === 'undefined') return undefined;
    const obs = new IntersectionObserver((entries) => entries[0].isIntersecting && cb.current(), { rootMargin: '600px' });
    obs.observe(el);
    return () => obs.disconnect();
  }, [enabled]);
  return ref;
}

export function useTheme() {
  const theme = useSelector((s) => s.ui.theme);
  const dispatch = useDispatch();
  useEffect(() => {
    const apply = () => {
      const dark = theme === 'dark' || (theme === 'system' && matchMedia('(prefers-color-scheme: dark)').matches);
      document.documentElement.classList.toggle('dark', dark);
    };
    apply();
    try {
      localStorage.setItem('circle.theme', theme);
    } catch {
      /* storage can be blocked */
    }
    const mq = matchMedia('(prefers-color-scheme: dark)');
    mq.addEventListener?.('change', apply);
    return () => mq.removeEventListener?.('change', apply);
  }, [theme]);
  return [theme, (t) => dispatch(setTheme(t))];
}

export function useDebounced(value, ms = 250) {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return v;
}

export function useTitle(title) {
  useEffect(() => {
    document.title = title ? `${title} · Circle` : 'Circle';
  }, [title]);
}
