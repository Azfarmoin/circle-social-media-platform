import { useSentinel } from '../../lib/hooks.js';
import { Spinner } from './index.jsx';

/** Placed at the end of a list: loads more when it scrolls near, and offers a manual button as a fallback. */
export default function Sentinel({ loading, done, error, onMore }) {
  const ref = useSentinel(onMore, !done && !error);
  if (done) return null;
  return (
    <div ref={ref} className="flex justify-center py-6">
      {loading ? <Spinner /> : error ? null : <button className="btn-soft" onClick={onMore}>Load more</button>}
    </div>
  );
}
