import browser from 'webextension-polyfill';

const BACKEND_URL = 'http://localhost:8000';

type Message =
  | { type: 'GET_AUTH' }
  | { type: 'LOGIN' }
  | { type: 'LOGOUT' }
  | { type: 'GET_USER_RATING'; channelLogin: string }
  | { type: 'FETCH_RATING'; login: string; channelLogin: string }
  | { type: 'CAST_VOTE'; login: string; channelLogin: string; value: 1 | -1 }
  | { type: 'GET_ALIASES' }
  | { type: 'SET_ALIAS'; login: string; alias: string }
  | { type: 'DELETE_ALIAS'; login: string }
  | { type: 'EXPORT_ALIASES' }
  | { type: 'IMPORT_ALIASES'; data: Array<{ login: string; alias: string }> }
  | { type: 'SYNC_ALIASES' };

interface StoredAuth {
  accessToken?: string;
  refreshToken?: string;
  expiresAt?: number;
  userLogin?: string;
  avatarUrl?: string;
}

interface StoredAliases {
  aliases?: Record<string, string>;
  aliasesSyncedAt?: number;
}

async function getStored(): Promise<StoredAuth & StoredAliases> {
  return browser.storage.local.get([
    'accessToken',
    'refreshToken',
    'expiresAt',
    'userLogin',
    'avatarUrl',
    'aliases',
    'aliasesSyncedAt',
  ]) as Promise<StoredAuth & StoredAliases>;
}

async function login(): Promise<{ success: boolean; userLogin?: string }> {
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

    // Sync aliases after successful login
    await syncAliasesWithServer();

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

// ── Alias helpers ────────────────────────────────────────────────────────────

async function getAliases(): Promise<Record<string, string>> {
  const { aliases } = await getStored();
  return aliases ?? {};
}

async function setAlias(login: string, alias: string): Promise<{ ok: boolean; error?: string }> {
  const normalizedLogin = login.toLowerCase().trim();
  const trimmedAlias = alias.trim();

  // Save locally first (offline-first)
  const { aliases } = await getStored();
  const next = { ...(aliases ?? {}) };
  if (!trimmedAlias || trimmedAlias.toLowerCase() === normalizedLogin) {
    delete next[normalizedLogin];
  } else {
    next[normalizedLogin] = trimmedAlias;
  }
  await browser.storage.local.set({ aliases: next });

  // Sync to server if authenticated
  const token = await getValidToken();
  if (token) {
    try {
      const res = await fetch(`${BACKEND_URL}/aliases`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ target_login: normalizedLogin, alias: trimmedAlias }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        return { ok: false, error: err.detail ?? String(res.status) };
      }
    } catch {
      // Network error — local alias is already saved, will retry on next sync
    }
  }

  return { ok: true };
}

async function deleteAlias(login: string): Promise<{ ok: boolean; error?: string }> {
  const normalizedLogin = login.toLowerCase().trim();

  const { aliases } = await getStored();
  const next = { ...(aliases ?? {}) };
  delete next[normalizedLogin];
  await browser.storage.local.set({ aliases: next });

  const token = await getValidToken();
  if (token) {
    try {
      const res = await fetch(`${BACKEND_URL}/aliases/${encodeURIComponent(normalizedLogin)}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok && res.status !== 404) {
        const err = await res.json().catch(() => ({}));
        return { ok: false, error: err.detail ?? String(res.status) };
      }
    } catch {
      // Network error — local alias is already removed, will retry on next sync
    }
  }

  return { ok: true };
}

async function exportAliases(): Promise<{ data: Array<{ login: string; alias: string }>; count: number }> {
  const aliases = await getAliases();
  const data = Object.entries(aliases).map(([login, alias]) => ({ login, alias }));
  return { data, count: data.length };
}

async function importAliases(
  items: Array<{ login: string; alias: string }>,
): Promise<{ ok: boolean; imported: number; error?: string }> {
  const aliases = await getAliases();
  const next = { ...aliases };
  let imported = 0;

  for (const item of items) {
    const login = item.login.toLowerCase().trim();
    const alias = item.alias.trim();
    if (!login || !alias) continue;
    next[login] = alias;
    imported++;
  }

  await browser.storage.local.set({ aliases: next });

  // Sync to server if authenticated (batch)
  const token = await getValidToken();
  if (token) {
    try {
      const payload = Object.entries(next).map(([login, alias]) => ({ target_login: login, alias }));
      const res = await fetch(`${BACKEND_URL}/aliases/import`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ aliases: payload }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        return { ok: false, error: err.detail ?? String(res.status), imported };
      }
      await browser.storage.local.set({ aliasesSyncedAt: Date.now() });
    } catch {
      return { ok: true, imported };
    }
  }

  return { ok: true, imported };
}

async function syncAliasesWithServer(): Promise<{ ok: boolean; error?: string }> {
  const token = await getValidToken();
  if (!token) return { ok: false, error: 'not_authenticated' };

  try {
    // Fetch server aliases
    const res = await fetch(`${BACKEND_URL}/aliases`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      return { ok: false, error: err.detail ?? String(res.status) };
    }
    const serverData = (await res.json()) as Array<{ target_login: string; alias: string }>;

    // Merge: server wins (they're the authoritative source for authenticated users)
    const merged: Record<string, string> = {};
    for (const item of serverData) {
      if (item.target_login && item.alias) {
        merged[item.target_login.toLowerCase()] = item.alias;
      }
    }

    // Also include any local aliases that aren't on server yet (push them)
    const { aliases: localAliases } = await getStored();
    const toPush: Array<{ target_login: string; alias: string }> = [];
    if (localAliases) {
      for (const [login, alias] of Object.entries(localAliases)) {
        if (!merged[login]) {
          merged[login] = alias;
          toPush.push({ target_login: login, alias });
        }
      }
    }

    // Push missing local aliases to server
    if (toPush.length > 0) {
      await fetch(`${BACKEND_URL}/aliases/import`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ aliases: toPush }),
      }).catch(() => {});
    }

    await browser.storage.local.set({ aliases: merged, aliasesSyncedAt: Date.now() });
    return { ok: true };
  } catch {
    return { ok: false, error: 'network_error' };
  }
}

// ── Message dispatcher ────────────────────────────────────────────────────────

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

      case 'FETCH_RATING':
        fetchRatingForCard(msg.login, msg.channelLogin).then(sendResponse);
        return true;

      case 'CAST_VOTE':
        castVote(msg.login, msg.channelLogin, msg.value).then(sendResponse);
        return true;

      case 'GET_ALIASES':
        getAliases().then((aliases) => sendResponse({ aliases }));
        return true;

      case 'SET_ALIAS':
        setAlias(msg.login, msg.alias).then(sendResponse);
        return true;

      case 'DELETE_ALIAS':
        deleteAlias(msg.login).then(sendResponse);
        return true;

      case 'EXPORT_ALIASES':
        exportAliases().then(sendResponse);
        return true;

      case 'IMPORT_ALIASES':
        importAliases(msg.data).then(sendResponse);
        return true;

      case 'SYNC_ALIASES':
        syncAliasesWithServer().then(sendResponse);
        return true;
    }
  },
);

// ── Sync aliases on startup if authenticated ────────────────────────────────

(async () => {
  const { accessToken } = await getStored();
  if (accessToken) {
    await syncAliasesWithServer().catch(() => {});
  }
})();
