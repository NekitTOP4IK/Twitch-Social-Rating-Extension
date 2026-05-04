import browser from 'webextension-polyfill';

const BACKEND_URL = 'http://localhost:8000';

type Message =
  | { type: 'GET_AUTH' }
  | { type: 'LOGIN' }
  | { type: 'LOGOUT' }
  | { type: 'GET_USER_RATING'; channelLogin: string }
  | { type: 'CAST_VOTE'; login: string; channelLogin: string; value: 1 | -1 };

interface StoredAuth {
  accessToken?: string;
  refreshToken?: string;
  expiresAt?: number;
  userLogin?: string;
  avatarUrl?: string;
}

async function getStored(): Promise<StoredAuth> {
  return browser.storage.local.get([
    'accessToken',
    'refreshToken',
    'expiresAt',
    'userLogin',
    'avatarUrl',
  ]) as Promise<StoredAuth>;
}

async function logout(): Promise<void> {
  await browser.storage.local.remove([
    'accessToken',
    'refreshToken',
    'expiresAt',
    'userLogin',
    'avatarUrl',
  ]);
}

async function refreshToken(): Promise<string | null> {
  const { refreshToken: rt } = await getStored();
  if (!rt) return null;
  try {
    const res = await fetch(`${BACKEND_URL}/auth/refresh`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refresh_token: rt }),
    });
    if (!res.ok) {
      await logout();
      return null;
    }
    const data = await res.json();
    await browser.storage.local.set({
      accessToken: data.access_token,
      refreshToken: data.refresh_token,
      expiresAt: Date.now() + 900_000,
    });
    return data.access_token as string;
  } catch {
    return null;
  }
}

async function getValidToken(): Promise<string | null> {
  const { accessToken, expiresAt } = await getStored();
  if (!accessToken) return null;
  if (!expiresAt || Date.now() > expiresAt - 60_000) {
    return refreshToken();
  }
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
  } catch {
    return null;
  }
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
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ value }),
      },
    );
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      return { ok: false, error: err.detail ?? String(res.status) };
    }
    const data = await res.json();
    return { ok: true, score: data.score };
  } catch {
    return { ok: false, error: 'network_error' };
  }
}

// —— Firefox OAuth: intercept /auth/extension-done via tabs.onUpdated ——

async function login(): Promise<{ success: boolean; userLogin?: string }> {
  const redirectUri = browser.runtime.getURL('callback.html');
  const authUrl =
    `${BACKEND_URL}/auth/twitch` +
    `?extension_redirect_uri=${encodeURIComponent(redirectUri)}`;

  try {
    const tab = await browser.tabs.create({ url: authUrl, active: true });

    return new Promise<{ success: boolean; userLogin?: string }>((resolve) => {
      let finished = false;

      const finish = (result: { success: boolean; userLogin?: string }) => {
        if (finished) return;
        finished = true;
        browser.tabs.onUpdated.removeListener(updatedListener);
        browser.tabs.onRemoved.removeListener(removedListener);
        browser.tabs.remove(tab.id!).catch(() => {});
        resolve(result);
      };

      const updatedListener = (
        updatedTabId: number,
        changeInfo: browser.Tabs.OnUpdatedChangeInfoType,
      ) => {
        if (updatedTabId !== tab.id) return;
        const url = changeInfo.url ?? '';
        if (!url.includes(`${BACKEND_URL}/auth/extension-done`)) return;

        try {
          const u = new URL(url);
          const accessToken = u.searchParams.get('access_token');
          const refreshToken = u.searchParams.get('refresh_token');
          const userLogin = u.searchParams.get('login') ?? undefined;
          const avatarUrl = u.searchParams.get('avatar_url') ?? undefined;
          const expiresIn = parseInt(u.searchParams.get('expires_in') ?? '900', 10);

          if (!accessToken || !refreshToken) {
            finish({ success: false });
            return;
          }

          browser.storage.local.set({
            accessToken,
            refreshToken,
            expiresAt: Date.now() + expiresIn * 1000,
            userLogin,
            avatarUrl,
          }).then(() => {
            finish({ success: true, userLogin });
          }).catch(() => finish({ success: false }));
        } catch {
          finish({ success: false });
        }
      };

      const removedListener = (removedTabId: number) => {
        if (removedTabId !== tab.id) return;
        finish({ success: false });
      };

      browser.tabs.onUpdated.addListener(updatedListener);
      browser.tabs.onRemoved.addListener(removedListener);

      // 5 min timeout
      setTimeout(() => finish({ success: false }), 300_000);
    });
  } catch {
    return { success: false };
  }
}

browser.runtime.onMessage.addListener(
  (message: unknown, _sender: browser.Runtime.MessageSender, sendResponse: (r: unknown) => void): true => {
    console.log('[TSR BG] received message', message);
    const msg = message as Message;
    switch (msg.type) {
      case 'GET_AUTH':
        console.log('[TSR BG] GET_AUTH');
        getStored().then(({ accessToken, userLogin, avatarUrl }) =>
          sendResponse({
            authenticated: !!accessToken,
            userLogin: userLogin ?? null,
            avatarUrl: avatarUrl ?? null,
          }),
        );
        return true;

      case 'LOGIN':
        console.log('[TSR BG] LOGIN');
        login().then(sendResponse);
        return true;

      case 'LOGOUT':
        console.log('[TSR BG] LOGOUT');
        logout().then(() => sendResponse({ success: true }));
        return true;

      case 'GET_USER_RATING':
        console.log('[TSR BG] GET_USER_RATING', msg.channelLogin);
        getUserRating(msg.channelLogin).then((res) => {
          console.log('[TSR BG] GET_USER_RATING result', res);
          sendResponse(res);
        });
        return true;

      case 'CAST_VOTE':
        console.log('[TSR BG] CAST_VOTE', msg.login, msg.channelLogin, msg.value);
        castVote(msg.login, msg.channelLogin, msg.value).then((res) => {
          console.log('[TSR BG] CAST_VOTE result', res);
          sendResponse(res);
        });
        return true;

      default:
        console.log('[TSR BG] unknown message type', (msg as any).type);
        sendResponse({});
        return true;
    }
  },
);
