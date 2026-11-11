import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useSearchParams, useLocation, Navigate } from 'react-router-dom';
import { useForm } from 'react-hook-form';
import { useDispatch, useSelector } from 'react-redux';
import { motion } from 'framer-motion';
import { CheckCircle2, XCircle, ShieldCheck } from 'lucide-react';
import { authApi } from '../../api/index.js';
import { errorMessage, errorCode, fieldErrors } from '../../api/http.js';
import { completeLogin } from '../../store/slices.js';
import { Field, Spinner } from '../../components/ui/index.jsx';
import { useTitle } from '../../lib/hooks.js';

export function AuthLayout({ title, subtitle, children, footer }) {
  return (
    <div className="flex min-h-full flex-col items-center justify-center px-4 py-10">
      <Link to="/" className="mb-6 flex items-center gap-2 text-2xl font-extrabold tracking-tight text-brand-600">
        <span className="flex h-10 w-10 items-center justify-center rounded-full border-4 border-brand-600"><span className="h-2.5 w-2.5 rounded-full bg-brand-600" /></span>Circle
      </Link>
      <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} className="card w-full max-w-md p-6 sm:p-8">
        <h1 className="text-xl font-bold">{title}</h1>
        {subtitle && <p className="mt-1 text-sm text-mute">{subtitle}</p>}
        <div className="mt-5">{children}</div>
      </motion.div>
      {footer && <p className="mt-5 text-sm text-mute">{footer}</p>}
    </div>
  );
}

const Banner = ({ kind = 'error', children }) => (
  <div role={kind === 'error' ? 'alert' : 'status'} className={`mb-4 rounded-xl px-3.5 py-2.5 text-sm ${kind === 'error' ? 'bg-red-50 text-red-700 dark:bg-red-500/15 dark:text-red-300' : 'bg-emerald-50 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300'}`}>{children}</div>
);

const strength = (p = '') => {
  let n = 0;
  if (p.length >= 8) n++;
  if (p.length >= 12) n++;
  if (/[A-Z]/.test(p) && /[a-z]/.test(p)) n++;
  if (/\d/.test(p) && /[^A-Za-z0-9]/.test(p)) n++;
  return n;
};
export function StrengthMeter({ value }) {
  const n = strength(value);
  const labels = ['Too short', 'Weak', 'Okay', 'Good', 'Strong'];
  return (
    <div className="mt-2" aria-live="polite">
      <div className="flex gap-1">{[0, 1, 2, 3].map((i) => <span key={i} className={`h-1 flex-1 rounded ${i < n ? ['bg-red-500', 'bg-amber-500', 'bg-lime-500', 'bg-emerald-500'][Math.max(0, n - 1)] : 'bg-line'}`} />)}</div>
      {value && <p className="mt-1 text-xs text-mute">{labels[n]}</p>}
    </div>
  );
}

export function Login() {
  useTitle('Log in');
  const dispatch = useDispatch();
  const navigate = useNavigate();
  const loc = useLocation();
  const status = useSelector((s) => s.auth.status);
  const [params] = useSearchParams();
  const { register, handleSubmit, formState: { errors, isSubmitting } } = useForm({ defaultValues: { remember: true } });
  const [needOtp, setNeedOtp] = useState(false);
  const [error, setError] = useState('');
  const [unverified, setUnverified] = useState('');
  const [resent, setResent] = useState(false);
  if (status === 'in') return <Navigate to={loc.state?.from || '/'} replace />;

  const onSubmit = async (v) => {
    setError(''); setUnverified('');
    try {
      const body = { identifier: v.identifier.trim(), password: v.password, remember: !!v.remember, ...(needOtp && v.otp ? { otp: v.otp.trim() } : {}) };
      const data = await authApi.login(body);
      if (data.twoFactorRequired) { setNeedOtp(true); return; }
      dispatch(completeLogin(data));
      navigate(loc.state?.from || '/', { replace: true });
    } catch (e) {
      if (errorCode(e) === 'EMAIL_NOT_VERIFIED') setUnverified(v.identifier);
      setError(errorMessage(e));
    }
  };
  const resend = async () => {
    try { await authApi.resendVerification(unverified.includes('@') ? unverified : ''); setResent(true); } catch (e) { setError(errorMessage(e)); }
  };

  return (
    <AuthLayout title="Welcome back" subtitle="Log in to see what your circle is up to." footer={<>New here? <Link className="font-semibold text-brand-600 hover:underline" to="/register">Create an account</Link></>}>
      {params.get('verified') && <Banner kind="ok">Email verified. You can log in now.</Banner>}
      {params.get('reset') && <Banner kind="ok">Password updated. Log in with your new password.</Banner>}
      {error && <Banner>{error}{unverified && unverified.includes('@') && !resent && <> <button type="button" className="font-semibold underline" onClick={resend}>Resend verification email</button></>}{resent && ' A new link is on its way.'}</Banner>}
      <form onSubmit={handleSubmit(onSubmit)} className="space-y-4" noValidate>
        {!needOtp ? (
          <>
            <Field label="Email or username" error={errors.identifier?.message}>
              <input className="input" autoComplete="username" autoFocus {...register('identifier', { required: 'Enter your email or username', minLength: { value: 3, message: 'That looks too short' } })} />
            </Field>
            <Field label="Password" error={errors.password?.message}>
              <input className="input" type="password" autoComplete="current-password" {...register('password', { required: 'Enter your password' })} />
            </Field>
            <div className="flex items-center justify-between text-sm">
              <label className="flex items-center gap-2"><input type="checkbox" className="accent-indigo-600" {...register('remember')} />Keep me signed in</label>
              <Link to="/forgot-password" className="font-semibold text-brand-600 hover:underline">Forgot password?</Link>
            </div>
          </>
        ) : (
          <>
            <div className="flex items-start gap-3 rounded-xl bg-brand-50 p-3 text-sm dark:bg-brand-500/15"><ShieldCheck className="mt-0.5 h-5 w-5 shrink-0 text-brand-600" />Enter the 6-digit code from your authenticator app, or one of your recovery codes.</div>
            <Field label="Authentication code" error={errors.otp?.message}>
              <input className="input tracking-widest" inputMode="numeric" autoComplete="one-time-code" autoFocus {...register('otp', { required: 'Enter your code' })} />
            </Field>
            <input type="hidden" {...register('identifier')} /><input type="hidden" {...register('password')} />
          </>
        )}
        <button className="btn-primary w-full" disabled={isSubmitting}>{isSubmitting && <Spinner className="h-4 w-4" />}{needOtp ? 'Verify and log in' : 'Log in'}</button>
        {needOtp && <button type="button" className="btn-ghost w-full" onClick={() => setNeedOtp(false)}>Back</button>}
      </form>
    </AuthLayout>
  );
}

export function Register() {
  useTitle('Create account');
  const { register, handleSubmit, watch, setError: setFieldError, formState: { errors, isSubmitting } } = useForm();
  const [done, setDone] = useState(null);
  const [error, setError] = useState('');
  const status = useSelector((s) => s.auth.status);
  if (status === 'in') return <Navigate to="/" replace />;

  const onSubmit = async (v) => {
    setError('');
    try {
      const res = await authApi.register({ name: v.name.trim(), username: v.username.trim().toLowerCase(), email: v.email.trim().toLowerCase(), password: v.password });
      setDone(res);
    } catch (e) {
      const f = fieldErrors(e);
      Object.entries(f).forEach(([k, m]) => ['name', 'username', 'email', 'password'].includes(k) && setFieldError(k, { message: m }));
      setError(errorMessage(e));
    }
  };

  if (done) {
    return (
      <AuthLayout title="Check your inbox">
        <div className="flex flex-col items-center gap-3 text-center"><CheckCircle2 className="h-10 w-10 text-emerald-500" />
          <p className="text-sm">{done.message}</p>
          {done.devVerifyUrl && <p className="w-full rounded-xl bg-line/50 p-3 text-left text-xs text-mute">Development mode: no real email is sent. <a className="break-all font-semibold text-brand-600 underline" href={new URL(done.devVerifyUrl).pathname + new URL(done.devVerifyUrl).search}>Open your verification link</a></p>}
          <Link className="btn-soft" to="/login">Go to log in</Link></div>
      </AuthLayout>
    );
  }
  return (
    <AuthLayout title="Create your account" subtitle="It only takes a minute." footer={<>Already have an account? <Link className="font-semibold text-brand-600 hover:underline" to="/login">Log in</Link></>}>
      {error && <Banner>{error}</Banner>}
      <form onSubmit={handleSubmit(onSubmit)} className="space-y-4" noValidate>
        <Field label="Full name" error={errors.name?.message}><input className="input" autoComplete="name" maxLength={60} {...register('name', { required: 'Enter your name', maxLength: 60 })} /></Field>
        <Field label="Username" hint="Letters, numbers and underscores" error={errors.username?.message}>
          <input className="input" autoComplete="username" {...register('username', { required: 'Choose a username', pattern: { value: /^[A-Za-z0-9_]{3,30}$/, message: 'Usernames are 3–30 characters: letters, numbers and underscores' } })} /></Field>
        <Field label="Email" error={errors.email?.message}>
          <input className="input" type="email" autoComplete="email" {...register('email', { required: 'Enter your email', pattern: { value: /^\S+@\S+\.\S+$/, message: 'Enter a valid email address' } })} /></Field>
        <Field label="Password" error={errors.password?.message}>
          <input className="input" type="password" autoComplete="new-password" {...register('password', { required: 'Choose a password', minLength: { value: 8, message: 'Use at least 8 characters' }, validate: (v) => (/[A-Za-z]/.test(v) && /\d/.test(v)) || 'Use at least one letter and one number' })} />
          <StrengthMeter value={watch('password')} /></Field>
        <button className="btn-primary w-full" disabled={isSubmitting}>{isSubmitting && <Spinner className="h-4 w-4" />}Create account</button>
      </form>
    </AuthLayout>
  );
}

export function VerifyEmail() {
  useTitle('Verify email');
  const [params] = useSearchParams();
  const [state, setState] = useState('loading');
  const [msg, setMsg] = useState('');
  const sent = useRef(null);
  useEffect(() => {
    const token = params.get('token');
    // the token is single-use: never send it twice (React StrictMode runs effects twice in development)
    if (sent.current === token) return;
    sent.current = token;
    if (!token) { setState('error'); setMsg('This verification link is incomplete.'); return; }
    authApi.verifyEmail(token).then((r) => { setState('ok'); setMsg(r.message); }).catch((e) => { setState('error'); setMsg(errorMessage(e)); });
  }, [params]);
  return (
    <AuthLayout title="Email verification">
      <div className="flex flex-col items-center gap-3 text-center">
        {state === 'loading' && <Spinner className="h-8 w-8" />}
        {state === 'ok' && <CheckCircle2 className="h-10 w-10 text-emerald-500" />}
        {state === 'error' && <XCircle className="h-10 w-10 text-red-500" />}
        <p className="text-sm" role="status">{state === 'loading' ? 'Verifying your email…' : msg}</p>
        {state !== 'loading' && <Link className="btn-primary" to="/login">Go to log in</Link>}
      </div>
    </AuthLayout>
  );
}

export function ForgotPassword() {
  useTitle('Reset password');
  const { register, handleSubmit, formState: { errors, isSubmitting } } = useForm();
  const [sent, setSent] = useState('');
  const [error, setError] = useState('');
  const onSubmit = async ({ email }) => {
    setError('');
    try { setSent((await authApi.forgot(email.trim().toLowerCase())).message); } catch (e) { setError(errorMessage(e)); }
  };
  return (
    <AuthLayout title="Forgot your password?" subtitle="Enter your email and we'll send a reset link." footer={<Link className="font-semibold text-brand-600 hover:underline" to="/login">Back to log in</Link>}>
      {sent ? <Banner kind="ok">{sent}</Banner> : (
        <form onSubmit={handleSubmit(onSubmit)} className="space-y-4" noValidate>
          {error && <Banner>{error}</Banner>}
          <Field label="Email" error={errors.email?.message}><input className="input" type="email" autoFocus {...register('email', { required: 'Enter your email', pattern: { value: /^\S+@\S+\.\S+$/, message: 'Enter a valid email address' } })} /></Field>
          <button className="btn-primary w-full" disabled={isSubmitting}>{isSubmitting && <Spinner className="h-4 w-4" />}Send reset link</button>
        </form>
      )}
    </AuthLayout>
  );
}

export function ResetPassword() {
  useTitle('Choose a new password');
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const { register, handleSubmit, watch, formState: { errors, isSubmitting } } = useForm();
  const [error, setError] = useState('');
  const onSubmit = async ({ newPassword }) => {
    setError('');
    try { await authApi.reset({ token: params.get('token') || '', newPassword }); navigate('/login?reset=1', { replace: true }); } catch (e) { setError(errorMessage(e)); }
  };
  return (
    <AuthLayout title="Choose a new password">
      {error && <Banner>{error} <Link to="/forgot-password" className="font-semibold underline">Request a new link</Link></Banner>}
      <form onSubmit={handleSubmit(onSubmit)} className="space-y-4" noValidate>
        <Field label="New password" error={errors.newPassword?.message}>
          <input className="input" type="password" autoComplete="new-password" autoFocus {...register('newPassword', { required: 'Choose a password', minLength: { value: 8, message: 'Use at least 8 characters' }, validate: (v) => (/[A-Za-z]/.test(v) && /\d/.test(v)) || 'Use at least one letter and one number' })} />
          <StrengthMeter value={watch('newPassword')} /></Field>
        <Field label="Confirm password" error={errors.confirm?.message}>
          <input className="input" type="password" autoComplete="new-password" {...register('confirm', { validate: (v) => v === watch('newPassword') || 'Passwords do not match' })} /></Field>
        <button className="btn-primary w-full" disabled={isSubmitting}>{isSubmitting && <Spinner className="h-4 w-4" />}Update password</button>
      </form>
    </AuthLayout>
  );
}
