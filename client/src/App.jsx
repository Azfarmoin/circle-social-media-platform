import { Component, Suspense, lazy, useEffect, useState } from 'react';
import { Routes, Route, Navigate, useLocation } from 'react-router-dom';
import { useDispatch, useSelector } from 'react-redux';
import { SearchX, WifiOff } from 'lucide-react';
import { Link } from 'react-router-dom';
import { bootstrap, signedOut } from './store/slices.js';
import { configureHttp } from './api/http.js';
import Shell from './components/layout/Shell.jsx';
import Realtime from './components/Realtime.jsx';
import { Toasts, Spinner, Empty } from './components/ui/index.jsx';
import { useTheme } from './lib/hooks.js';

// Every page except the shell loads on demand, so the first paint ships far less JavaScript.
const named = (loader, name) => lazy(() => loader().then((m) => ({ default: m[name] })));
const auth = () => import('./pages/auth/Auth.jsx');
const feed = () => import('./pages/Feed.jsx');
const social = () => import('./pages/Social.jsx');
const Login = named(auth, 'Login');
const Register = named(auth, 'Register');
const VerifyEmail = named(auth, 'VerifyEmail');
const ForgotPassword = named(auth, 'ForgotPassword');
const ResetPassword = named(auth, 'ResetPassword');
const Home = named(feed, 'Home');
const Explore = named(feed, 'Explore');
const Hashtag = named(feed, 'Hashtag');
const Saved = named(feed, 'Saved');
const PostPage = named(feed, 'PostPage');
const SearchPage = named(feed, 'SearchPage');
const Friends = named(social, 'Friends');
const Notifications = named(social, 'Notifications');
const Profile = lazy(() => import('./pages/Profile.jsx'));
const Messages = lazy(() => import('./pages/Messages.jsx'));
const Settings = lazy(() => import('./pages/settings/Settings.jsx'));
const Admin = lazy(() => import('./pages/admin/Admin.jsx'));


function OfflineBanner() {
  const [online, setOnline] = useState(typeof navigator === 'undefined' ? true : navigator.onLine);
  useEffect(() => {
    const up = () => setOnline(true);
    const down = () => setOnline(false);
    window.addEventListener('online', up);
    window.addEventListener('offline', down);
    return () => { window.removeEventListener('online', up); window.removeEventListener('offline', down); };
  }, []);
  if (online) return null;
  return (
    <div role="status" className="fixed inset-x-0 top-0 z-[60] flex items-center justify-center gap-2 bg-amber-500 px-3 py-1.5 text-sm font-semibold text-black">
      <WifiOff className="h-4 w-4" /> You are offline. Changes will not be saved until you reconnect.
    </div>
  );
}

const PageLoader = () => <div className="flex min-h-[40vh] items-center justify-center"><Spinner className="h-7 w-7 text-brand-600" /></div>;

class Boundary extends Component {
  state = { error: null };
  static getDerivedStateFromError(error) { return { error }; }
  componentDidCatch(error) { console.error(error); }
  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div className="flex min-h-[50vh] items-center justify-center p-6">
        <div className="card max-w-md space-y-3 p-6 text-center" role="alert"><h1 className="text-lg font-bold">Something broke</h1>
          <p className="text-sm text-mute">An unexpected error occurred on this page.</p>
          <button className="btn-primary" onClick={() => { this.setState({ error: null }); location.assign('/'); }}>Reload Circle</button></div>
      </div>
    );
  }
}

function Protected({ children }) {
  const { status, user } = useSelector((s) => s.auth);
  const loc = useLocation();
  if (status === 'booting') return <div className="flex h-full items-center justify-center"><Spinner className="h-8 w-8 text-brand-600" /></div>;
  if (status !== 'in') return <Navigate to="/login" replace state={{ from: loc.pathname + loc.search }} />;
  return <><Realtime userId={user._id} />{children}</>;
}

export default function App() {
  const dispatch = useDispatch();
  useTheme();
  useEffect(() => {
    configureHttp({ onSessionEnded: () => dispatch(signedOut()) });
    dispatch(bootstrap());
  }, [dispatch]);
  return (
    <Boundary>
      <OfflineBanner />
      <Suspense fallback={<PageLoader />}>
      <Routes>
        <Route path="/login" element={<Login />} />
        <Route path="/register" element={<Register />} />
        <Route path="/verify-email" element={<VerifyEmail />} />
        <Route path="/forgot-password" element={<ForgotPassword />} />
        <Route path="/reset-password" element={<ResetPassword />} />
        <Route element={<Protected><Shell /></Protected>}>
          <Route index element={<Home />} />
          <Route path="explore" element={<Explore />} />
          <Route path="friends" element={<Friends />} />
          <Route path="messages/:id?" element={<Messages />} />
          <Route path="notifications" element={<Notifications />} />
          <Route path="saved" element={<Saved />} />
          <Route path="search" element={<SearchPage />} />
          <Route path="hashtag/:tag" element={<Hashtag />} />
          <Route path="post/:id" element={<PostPage />} />
          <Route path="u/:username/:tab?" element={<Profile />} />
          <Route path="settings/:section?" element={<Settings />} />
          <Route path="admin" element={<Admin />} />
          <Route path="*" element={<Empty icon={SearchX} title="Page not found" hint="The page you're looking for doesn't exist." action={<Link to="/" className="btn-primary mt-2">Go home</Link>} />} />
        </Route>
      </Routes>
      </Suspense>
      <Toasts />
    </Boundary>
  );
}
