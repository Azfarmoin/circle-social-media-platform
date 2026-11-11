import { createSlice, createAsyncThunk, createEntityAdapter } from '@reduxjs/toolkit';
import { authApi, notificationApi, messageApi } from '../api/index.js';
import { setAccessToken, refreshSession, csrfToken } from '../api/http.js';

// ------------------------------------------------------------------ auth
export const bootstrap = createAsyncThunk('auth/bootstrap', async () => {
  // no csrf cookie means there is no session to restore, so skip the doomed request
  if (!csrfToken()) return null;
  try {
    const data = await refreshSession();
    return data.user;
  } catch {
    return null;
  }
});

const authSlice = createSlice({
  name: 'auth',
  initialState: { user: null, status: 'booting' }, // booting | out | in
  reducers: {
    signedIn(state, { payload }) {
      state.user = payload;
      state.status = 'in';
    },
    signedOut(state) {
      state.user = null;
      state.status = 'out';
    },
    userUpdated(state, { payload }) {
      if (state.user) state.user = { ...state.user, ...payload };
    },
  },
  extraReducers: (b) => {
    b.addCase(bootstrap.fulfilled, (state, { payload }) => {
      state.user = payload;
      state.status = payload ? 'in' : 'out';
    });
  },
});
export const { signedIn, signedOut, userUpdated } = authSlice.actions;

export const completeLogin = (data) => (dispatch) => {
  setAccessToken(data.accessToken);
  dispatch(signedIn(data.user));
};
export const logout = () => async (dispatch) => {
  try {
    await authApi.logout();
  } catch {
    /* the local session is cleared either way */
  }
  setAccessToken(null);
  dispatch(signedOut());
};

// ------------------------------------------------------------------ ui (theme + toasts)
const readTheme = () => {
  try {
    return localStorage.getItem('circle.theme') || 'system';
  } catch {
    return 'system';
  }
};
let toastId = 0;
const uiSlice = createSlice({
  name: 'ui',
  initialState: { theme: readTheme(), toasts: [] },
  reducers: {
    setTheme(state, { payload }) {
      state.theme = payload;
    },
    pushToast: {
      reducer(state, { payload }) {
        state.toasts = [...state.toasts.slice(-3), payload];
      },
      prepare: (message, kind = 'info', extra = {}) => ({ payload: { id: ++toastId, message, kind, ...extra } }),
    },
    dismissToast(state, { payload }) {
      state.toasts = state.toasts.filter((t) => t.id !== payload);
    },
  },
});
export const { setTheme, pushToast, dismissToast } = uiSlice.actions;

// ------------------------------------------------------------------ normalized posts, shared by every list and the realtime layer
const postsAdapter = createEntityAdapter({ selectId: (p) => p._id });
const postsSlice = createSlice({
  name: 'posts',
  initialState: postsAdapter.getInitialState(),
  reducers: {
    upsertPosts: postsAdapter.upsertMany,
    upsertPost: postsAdapter.upsertOne,
    patchPost(state, { payload: { id, changes } }) {
      const p = state.entities[id];
      if (p) Object.assign(p, changes);
    },
    removePost: postsAdapter.removeOne,
    pollUpdate(state, { payload }) {
      const p = state.entities[payload.postId];
      if (p?.poll) {
        p.poll.options = payload.options;
        p.poll.totalVotes = payload.totalVotes;
      }
    },
    // optimistic reaction: adjust the counters locally, the server response then replaces them
    applyReaction(state, { payload: { id, type } }) {
      const p = state.entities[id];
      if (!p) return;
      const prev = p.myReaction;
      if (prev) {
        p.reactionCounts[prev] = Math.max(0, (p.reactionCounts[prev] || 0) - 1);
        p.reactionTotal = Math.max(0, p.reactionTotal - 1);
      }
      if (type) {
        p.reactionCounts[type] = (p.reactionCounts[type] || 0) + 1;
        p.reactionTotal += 1;
      }
      p.myReaction = type;
    },
  },
});
export const { upsertPosts, upsertPost, patchPost, removePost, applyReaction, pollUpdate } = postsSlice.actions;
export const postSelectors = postsAdapter.getSelectors((s) => s.posts);

// ------------------------------------------------------------------ notifications
export const loadUnread = createAsyncThunk('notifications/unread', async () => (await notificationApi.unread()).unread);
const notifSlice = createSlice({
  name: 'notifications',
  initialState: { unread: 0, live: null },
  reducers: {
    received(state, { payload }) {
      state.unread += 1;
      state.live = payload;
    },
    clearUnread(state) {
      state.unread = 0;
    },
    decrement(state, { payload = 1 }) {
      state.unread = Math.max(0, state.unread - payload);
    },
  },
  extraReducers: (b) => {
    b.addCase(loadUnread.fulfilled, (s, { payload }) => {
      s.unread = payload;
    });
  },
});
export const { received, clearUnread, decrement } = notifSlice.actions;

// ------------------------------------------------------------------ chat (unread badge only; threads live in the Messages page)
export const loadChatUnread = createAsyncThunk('chat/unread', async () => (await messageApi.unread()).unread);
const chatSlice = createSlice({
  name: 'chat',
  initialState: { unread: 0 },
  reducers: {},
  extraReducers: (b) => {
    b.addCase(loadChatUnread.fulfilled, (s, { payload }) => {
      s.unread = payload;
    });
  },
});

export const reducers = {
  chat: chatSlice.reducer,
  auth: authSlice.reducer,
  ui: uiSlice.reducer,
  posts: postsSlice.reducer,
  notifications: notifSlice.reducer,
};
