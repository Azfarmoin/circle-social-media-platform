import { describe, it, expect, vi, beforeEach } from 'vitest';
import axios from 'axios';
import { http, setAccessToken, getAccessToken, configureHttp, errorMessage, errorCode } from '../src/api/http.js';

// Replace the network with an adapter so the real interceptors run.
function stub(handler) {
  http.defaults.adapter = async (config) => {
    const r = await handler(config);
    if (r.status >= 400) {
      const err = new Error('fail');
      err.config = config; err.response = { status: r.status, data: r.data || {}, config };
      throw err;
    }
    return { data: r.data, status: r.status, statusText: 'OK', headers: {}, config };
  };
}

describe('http client', () => {
  beforeEach(() => { setAccessToken(null); document.cookie = 'csrf=tok123'; });

  it('sends the access token as a bearer header', async () => {
    setAccessToken('abc');
    let seen;
    stub((c) => { seen = c.headers.Authorization; return { status: 200, data: {} }; });
    await http.get('/x');
    expect(seen).toBe('Bearer abc');
  });

  it('refreshes once for several concurrent 401s, then retries each request', async () => {
    setAccessToken('old');
    const post = vi.spyOn(axios, 'post').mockResolvedValue({ data: { accessToken: 'new', user: {} } });
    stub((c) => (c.headers.Authorization === 'Bearer new' ? { status: 200, data: { ok: c.url } } : { status: 401 }));
    const results = await Promise.all([http.get('/a'), http.get('/b'), http.get('/c')]);
    expect(results.map((r) => r.data.ok)).toEqual(['/a', '/b', '/c']);
    expect(post).toHaveBeenCalledTimes(1);
    expect(post.mock.calls[0][2].headers['X-CSRF-Token']).toBe('tok123');
    expect(getAccessToken()).toBe('new');
    post.mockRestore();
  });

  it('ends the session when the refresh fails', async () => {
    const ended = vi.fn();
    configureHttp({ onSessionEnded: ended });
    setAccessToken('old');
    const post = vi.spyOn(axios, 'post').mockRejectedValue(new Error('nope'));
    stub(() => ({ status: 401 }));
    await expect(http.get('/a')).rejects.toBeTruthy();
    expect(ended).toHaveBeenCalled();
    expect(getAccessToken()).toBeNull();
    post.mockRestore();
  });

  it('does not try to refresh a failed login', async () => {
    const post = vi.spyOn(axios, 'post');
    stub(() => ({ status: 401, data: { message: 'Incorrect email/username or password', code: 'BAD_CREDENTIALS' } }));
    const err = await http.post('/auth/login', {}).catch((e) => e);
    expect(post).not.toHaveBeenCalled();
    expect(errorMessage(err)).toBe('Incorrect email/username or password');
    expect(errorCode(err)).toBe('BAD_CREDENTIALS');
    post.mockRestore();
  });

  it('turns network failures into a readable message', () => {
    expect(errorMessage({ code: 'ERR_NETWORK' })).toMatch(/cannot reach the server/i);
  });
});
