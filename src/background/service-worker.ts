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

async function login(): Promise<{ success: boolean; userLogin?: string }> {
  // Backend must redirect to this URI with tokens in the fragment after OAuth
  // e.g. GET /auth/twitch?extension_redirect_uri=<redirectUri>
  const redirectUri = browser.identity.getRedirectURL('callback');
  const authUrl =
    `${BACKEND_URL}/auth/twitch` +
    `?extension_redirect_uri=${encodeURIComponent(redirectUri)}`;

  try {
    const responseUrl = await browser.identity.launchWebAuthFlow({
      url: authUrl,
      interactive: true,
    });

    const url = new URL(responseUrl);
    // Backend returns tokens in fragment: #access_token=...&refresh_token=...&login=...
    const params = new URLSearchParams(
      url.hash ? url.hash.slice(1) : url.search.slice(1),
    );

    const accessToken = params.get('access_token');
    const refreshToken = params.get('refresh_token');
    const userLogin = params.get('login') ?? undefined;
    const avatarUrl = params.get('avatar_url') ?? undefined;
    const expiresIn = parseInt(params.get('expires_in') ?? '900', 10);

    if (!accessToken || !refreshToken) return { success: false };

    await browser.storage.local.set({
      accessToken,
      refreshToken,
      expiresAt: Date.now() + expiresIn * 1000,
      userLogin,
      avatarUrl,
    });
    return { success: true, userLogin };
  } catch {
    return { success: false };
  }
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
  // Refresh 60s before expiry
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

browser.runtime.onMessage.addListener(
  (message: unknown, _sender: browser.Runtime.MessageSender, sendResponse: (r: unknown) => void) => {
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

      case 'CAST_VOTE':
        castVote(msg.login, msg.channelLogin, msg.value).then(sendResponse);
        return true;
    }
  },
);
