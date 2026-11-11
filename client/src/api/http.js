import axios from 'axios';

// The access token lives only in memory. The refresh token is an httpOnly cookie the page cannot read.
let accessToken = null;
let onSessionEnded = () => {};
let onTokenChange = () => {};

export const setAccessToken = (t) => {
  accessToken = t;
  onTokenChange(t);
};
export const getAccessToken = () => accessToken;
export const configureHttp = (h) => {
  if (h.onSessionEnded) onSessionEnded = h.onSessionEnded;
  if (h.onTokenChange) onTokenChange = h.onTokenChange;
};

const readCookie = (name) => {
  const m = document.cookie.split('; ').find((c) => c.startsWith(`${name}=`));
  return m ? decodeURIComponent(m.slice(name.length + 1)) : '';
};

export const http = axios.create({ baseURL: '/api', withCredentials: true, timeout: 30000 });

http.interceptors.request.use((cfg) => {
  if (accessToken) cfg.headers.Authorization = `Bearer ${accessToken}`;
  return cfg;
});

// One refresh at a time: concurrent 401s all wait on the same request.
let refreshing = null;
export function refreshSession() {
  if (!refreshing) {
    refreshing = axios
      .post('/api/auth/refresh', null, { withCredentials: true, headers: { 'X-CSRF-Token': readCookie('csrf') } })
      .then((res) => {
        setAccessToken(res.data.accessToken);
        return res.data;
      })
      .finally(() => {
        refreshing = null;
      });
  }
  return refreshing;
}

const NO_RETRY = ['/auth/login', '/auth/register', '/auth/refresh', '/auth/logout', '/auth/forgot-password', '/auth/reset-password', '/auth/verify-email'];

http.interceptors.response.use(
  (res) => res,
  async (error) => {
    const { config, response } = error;
    if (response?.status === 401 && config && !config._retried && !NO_RETRY.some((p) => config.url?.startsWith(p))) {
      config._retried = true;
      try {
        await refreshSession();
        config.headers.Authorization = `Bearer ${accessToken}`;
        return http(config);
      } catch {
        setAccessToken(null);
        onSessionEnded();
      }
    }
    return Promise.reject(error);
  }
);

export const errorMessage = (err, fallback = 'Something went wrong. Please try again.') => {
  if (!err?.response) return err?.code === 'ECONNABORTED' ? 'The request timed out.' : 'Cannot reach the server. Check your connection.';
  const d = err.response.data;
  return d?.message || fallback;
};
export const errorCode = (err) => err?.response?.data?.code || '';
export const fieldErrors = (err) => Object.fromEntries((err?.response?.data?.errors || []).map((e) => [e.field, e.message]));
export const csrfToken = () => readCookie('csrf');
