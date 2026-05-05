import browser from 'webextension-polyfill';

const BACKEND_URL = 'http://localhost:8000';

type Message =
  | { type: 'GET_AUTH' }
  | { type: 'LOGIN' }
  | { type: 'LOGOUT' }
  | { type: 'GET_USER_RATING'; channelLogin: string }
  | { type: 'FETCH_RATING'; login: string; channelLogin: string }
  | { type: 'CAST_VOTE'; login: string; channelLogin: string; value: 1 | -1 }
  | { type: 'OAUTH_CALLBACK'; access_token: string; refresh_token: string; login?: string; avatar_url?: string; expires_in?: string };

interface StoredAuth {
  accessToken?: string;
  refreshToken?: string;
  expiresAt?: number;
  userLogin?: string;
  avatarUrl?: string;
}

async function getStored(): Promise<StoredAuth> {
  return browser.storage.local.get([
    'accessToken', 'refreshToken', 'expiresAt', 'userLogin', 'avatarUrl',
  ]) as Promise<StoredAuth>;
}

async function logout(): Promise<void> {
  await browser.storage.local.remove([
    'accessToken', 'refreshToken', 'expiresAt', 'userLogin', 'avatarUrl',
  ]);
}

async function doRefresh(): Promise<string | null> {
  const { refreshToken: rt } = await getStored();
  if (!rt) return null;
  try {
    const res = await fetch(`${BACKEND_URL}/auth/refresh`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refresh_token: rt }),
    });
    if (!res.ok) { await logout(); return null; }
    const data = await res.json();
    await browser.storage.local.set({
      accessToken: data.access_token,
      refreshToken: data.refresh_token,
      expiresAt: Date.now() + 900_000,
    });
    return data.access_token as string;
  } catch { return null; }
}

async function getValidToken(): Promise<string | null> {
  const { accessToken, expiresAt } = await getStored();
  if (!accessToken) return null;
  if (!expiresAt || Date.now() > expiresAt - 60_000) return doRefresh();
  return accessToken;
}

async function getUserRating(channelLogin: string): Promise<{ score?: number } | null> {
  const { userLogin } = await getStored();
  if (!userLogin) return null;
  try {
    const res = await fetch(
      `${BACKEND_URL}/ratings/${encodeURIComponent(channelLogin)}/${encodeURIComponent(userLogin)}`,
    );
    if (!res.ok) return null;
    const data = await res.json();
    return { score: data.score };
  } catch { return null; }
}

async function fetchRatingForCard(
  login: string,
  channelLogin: string,
): Promise<{ login: string; score: number; isLowRating: boolean } | null> {
  try {
    const res = await fetch(
      `${BACKEND_URL}/ratings/${encodeURIComponent(channelLogin)}/${encodeURIComponent(login)}`,
    );
    if (!res.ok) return null;
    const data = await res.json();
    return { login: data.login, score: data.score, isLowRating: data.score < 0 };
  } catch { return null; }
}

async function castVote(
  login: string,
  channelLogin: string,
  value: 1 | -1,
): Promise<{ ok: boolean; score?: number; error?: string }> {
  const token = await getValidToken();
  if (!token) return { ok: false, error: 'not_authenticated' };
  try {
    const res = await fetch(
      `${BACKEND_URL}/ratings/${encodeURIComponent(channelLogin)}/${encodeURIComponent(login)}/vote`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ value }),
      },
    );
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      return { ok: false, error: err.detail ?? String(res.status) };
    }
    const data = await res.json();
    return { ok: true, score: data.score };
  } catch { return { ok: false, error: 'network_error' }; }
}

// ── OAuth login state ─────────────────────────────────────────────────────────
// Two paths are tried in parallel:
//   Primary:  callback.html sends OAUTH_CALLBACK message after page load
//   Backup:   tabs.onUpdated intercepts the redirect URL before page load
// Whichever resolves first wins; the other becomes a no-op.

type LoginResolve = (r: { success: boolean; userLogin?: string }) => void;

let loginResolve: LoginResolve | null = null;
let loginTabId: number | null = null;
let loginUpdListener: ((tid: number, ci: browser.Tabs.OnUpdatedChangeInfoType) => void) | null = null;
let loginRmvListener: ((tid: number) => void) | null = null;

function cleanupListeners(): void {
  if (loginUpdListener) {
    browser.tabs.onUpdated.removeListener(loginUpdListener);
    loginUpdListener = null;
  }
  if (loginRmvListener) {
    browser.tabs.onRemoved.removeListener(loginRmvListener);
    loginRmvListener = null;
  }
}

function finishLogin(result: { success: boolean; userLogin?: string }, closeTab = true): void {
  cleanupListeners();
  const tid = loginTabId;
  const resolve = loginResolve;
  loginTabId = null;
  loginResolve = null;
  if (resolve) resolve(result);
  if (closeTab && tid != null) browser.tabs.remove(tid).catch(() => {});
}

async function storeTokens(
  accessToken: string,
  refreshToken: string,
  userLogin: string | undefined,
  avatarUrl: string | undefined,
  expiresIn: number,
): Promise<void> {
  await browser.storage.local.set({
    accessToken,
    refreshToken,
    expiresAt: Date.now() + expiresIn * 1000,
    userLogin,
    avatarUrl,
  });
}

async function login(): Promise<{ success: boolean; userLogin?: string }> {
  // Cancel any in-progress login
  if (loginResolve) finishLogin({ success: false }, true);

  const callbackUrl = browser.runtime.getURL('callback.html');
  const authUrl =
    `${BACKEND_URL}/auth/twitch` +
    `?extension_redirect_uri=${encodeURIComponent(callbackUrl)}`;

  let tab: browser.Tabs.Tab;
  try {
    tab = await browser.tabs.create({ url: authUrl, active: true });
  } catch {
    return { success: false };
  }
  loginTabId = tab.id!;

  return new Promise<{ success: boolean; userLogin?: string }>((resolve) => {
    loginResolve = resolve;

    // Intercept OAuth redirect via tabs.onUpdated.
    // Backend redirects to http://localhost:8000/auth/extension-done?tokens (query params).
    // As a fallback also catch moz-extension://...callback.html in case backend is changed.
    const callbackBase = callbackUrl.split('?')[0].split('#')[0];
    loginUpdListener = (uid: number, ci: browser.Tabs.OnUpdatedChangeInfoType) => {
      if (uid !== loginTabId || !ci.url) return;
      const url = ci.url;
      // Two possible redirect targets from the backend
      const isExtDone = url.includes('/auth/extension-done');
      const isCallbackPage = url.startsWith(callbackBase);
      if (!isExtDone && !isCallbackPage) return;
      try {
        const u = new URL(url);
        // Backend-done URL uses query params; callback.html may use fragment
        const src = (isCallbackPage && u.hash.length > 1) ? u.hash.slice(1) : u.search.slice(1);
        const p = new URLSearchParams(src);
        const at = p.get('access_token');
        const rt = p.get('refresh_token');
        if (!at || !rt) return;
        const ul = p.get('login') ?? undefined;
        const av = p.get('avatar_url') ?? undefined;
        const ei = parseInt(p.get('expires_in') ?? '900', 10);
        storeTokens(at, rt, ul, av, ei)
          .then(() => finishLogin({ success: true, userLogin: ul }, true))
          .catch(() => finishLogin({ success: false }, true));
      } catch { /* malformed URL */ }
    };

    // Fallback: user closed the tab
    loginRmvListener = (uid: number) => {
      if (uid !== loginTabId) return;
      loginTabId = null; // tab is already gone
      finishLogin({ success: false }, false);
    };

    browser.tabs.onUpdated.addListener(loginUpdListener);
    browser.tabs.onRemoved.addListener(loginRmvListener);

    // 5-minute hard timeout
    setTimeout(() => {
      if (loginResolve === resolve) finishLogin({ success: false }, true);
    }, 300_000);
  });
}

// ── Message listener ──────────────────────────────────────────────────────────

browser.runtime.onMessage.addListener(
  (
    message: unknown,
    _sender: browser.Runtime.MessageSender,
    sendResponse: (r: unknown) => void,
  ): true => {
    const msg = message as Message;

    switch (msg.type) {
      case 'GET_AUTH':
        getStored().then(({ accessToken, userLogin, avatarUrl }) =>
          sendResponse({
            authenticated: !!accessToken,
            userLogin: userLogin ?? null,
            avatarUrl: avatarUrl ?? null,
          }),
        );
        return true;

      case 'LOGIN':
        login().then(sendResponse);
        return true;

      case 'LOGOUT':
        logout().then(() => sendResponse({ success: true }));
        return true;

      case 'GET_USER_RATING':
        getUserRating(msg.channelLogin).then(sendResponse);
        return true;

      case 'FETCH_RATING':
        fetchRatingForCard(msg.login, msg.channelLogin).then(sendResponse);
        return true;

      case 'CAST_VOTE':
        castVote(msg.login, msg.channelLogin, msg.value).then(sendResponse);
        return true;

      case 'OAUTH_CALLBACK': {
        // Primary path: callback.html loaded successfully and sent us the tokens.
        const at = msg.access_token;
        const rt = msg.refresh_token;
        if (!at || !rt) {
          finishLogin({ success: false }, true);
          sendResponse({ ok: false });
          return true;
        }
        const ul = msg.login ?? undefined;
        const av = msg.avatar_url ?? undefined;
        const ei = parseInt(msg.expires_in ?? '900', 10);
        storeTokens(at, rt, ul, av, ei)
          .then(() => {
            finishLogin({ success: true, userLogin: ul }, true);
            sendResponse({ ok: true });
          })
          .catch(() => {
            finishLogin({ success: false }, true);
            sendResponse({ ok: false });
          });
        return true;
      }

      default:
        sendResponse({});
        return true;
    }
  },
);
