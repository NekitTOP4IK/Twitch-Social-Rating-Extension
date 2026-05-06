import browser from 'webextension-polyfill';
import { debug, error } from '../utils/logger';

declare const __BACKEND_URL__: string;
export const BACKEND_URL = __BACKEND_URL__;

export interface StoredAuth {
  accessToken?: string;
  refreshToken?: string;
  expiresAt?: number;
  userLogin?: string;
  avatarUrl?: string;
}

export interface StoredAliases {
  aliases?: Record<string, string>;
  aliasesSyncedAt?: number;
}

export async function getStored(): Promise<StoredAuth & StoredAliases> {
  const data = await browser.storage.local.get([
    'accessToken', 'refreshToken', 'expiresAt', 'userLogin', 'avatarUrl',
    'aliases', 'aliasesSyncedAt',
  ]) as StoredAuth & StoredAliases;
  debug('shared', 'getStored accessToken=', !!data.accessToken, 'userLogin=', data.userLogin);
  return data;
}

export async function storeTokens(
  accessToken: string,
  refreshToken: string,
  userLogin: string | undefined,
  avatarUrl: string | undefined,
  expiresIn: number,
): Promise<void> {
  debug('shared', 'storeTokens userLogin=', userLogin);
  await browser.storage.local.set({
    accessToken,
    refreshToken,
    expiresAt: Date.now() + expiresIn * 1000,
    userLogin,
    avatarUrl,
  });
}

export async function clearTokens(): Promise<void> {
  await browser.storage.local.remove([
    'accessToken', 'refreshToken', 'expiresAt', 'userLogin', 'avatarUrl',
  ]);
}

async function doRefresh(): Promise<string | null> {
  const { refreshToken: rt } = await getStored();
  debug('shared', 'doRefresh rt=', !!rt);
  if (!rt) return null;
  try {
    const res = await fetch(`${BACKEND_URL}/auth/refresh`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refresh_token: rt }),
    });
    debug('shared', 'doRefresh res.ok=', res.ok, 'status=', res.status);
    if (!res.ok) { await clearTokens(); return null; }
    const data = await res.json();
    await browser.storage.local.set({
      accessToken: data.access_token,
      refreshToken: data.refresh_token,
      expiresAt: Date.now() + 900_000,
    });
    debug('shared', 'doRefresh success');
    return data.access_token as string;
  } catch (e) {
    error('shared', 'doRefresh error:', e);
    return null;
  }
}

export async function getValidToken(): Promise<string | null> {
  const { accessToken, expiresAt } = await getStored();
  debug('shared', 'getValidToken hasToken=', !!accessToken, 'expiresAt=', expiresAt, 'now=', Date.now());
  if (!accessToken) return null;
  if (!expiresAt || Date.now() > expiresAt - 60_000) return doRefresh();
  return accessToken;
}

export async function refreshMe(): Promise<{ ok: boolean; avatarUrl?: string; login?: string }> {
  const token = await getValidToken();
  debug('shared', 'refreshMe token=', !!token);
  if (!token) return { ok: false };
  try {
    const res = await fetch(`${BACKEND_URL}/users/me`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    debug('shared', 'refreshMe res.ok=', res.ok, 'status=', res.status);
    if (!res.ok) return { ok: false };
    const data = await res.json();
    const avatarUrl = data.avatar_url ?? undefined;
    const login = data.login ?? undefined;
    await browser.storage.local.set({ avatarUrl, userLogin: login });
    debug('shared', 'refreshMe updated avatarUrl=', !!avatarUrl, 'login=', login);
    return { ok: true, avatarUrl, login };
  } catch (e) {
    error('shared', 'refreshMe error:', e);
    return { ok: false };
  }
}

export async function getUserRating(channelLogin: string): Promise<{ score?: number } | null> {
  const { userLogin } = await getStored();
  if (!userLogin) return null;
  try {
    const url = `${BACKEND_URL}/ratings/${encodeURIComponent(channelLogin)}/${encodeURIComponent(userLogin)}`;
    const res = await fetch(url);
    if (!res.ok) {
      error('shared', 'getUserRating failed:', res.status, url);
      return null;
    }
    return { score: (await res.json()).score };
  } catch (e) {
    error('shared', 'getUserRating network error:', e);
    return null;
  }
}

export async function fetchRatingForCard(
  login: string,
  channelLogin: string,
): Promise<{ login: string; score: number; isLowRating: boolean } | null> {
  try {
    const url = `${BACKEND_URL}/ratings/${encodeURIComponent(channelLogin)}/${encodeURIComponent(login)}`;
    const res = await fetch(url);
    if (!res.ok) {
      error('shared', 'fetchRatingForCard failed:', res.status, url);
      return null;
    }
    const data = await res.json();
    return { login: data.login, score: data.score, isLowRating: data.score < 0 };
  } catch (e) {
    error('shared', 'fetchRatingForCard network error:', e);
    return null;
  }
}

export async function castVote(
  login: string,
  channelLogin: string,
  value: 1 | -1,
): Promise<{ ok: boolean; score?: number; error?: string; nextVoteAt?: number }> {
  const token = await getValidToken();
  debug('shared', 'castVote token=', !!token, 'login=', login, 'channel=', channelLogin, 'value=', value);
  if (!token) return { ok: false, error: 'not_authenticated' };
  try {
    const url = `${BACKEND_URL}/ratings/${encodeURIComponent(channelLogin)}/${encodeURIComponent(login)}/vote`;
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ value }),
    });
    debug('shared', 'castVote res.ok=', res.ok, 'status=', res.status);
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      const detail = err.detail;
      if (detail && typeof detail === 'object' && detail.next_vote_at) {
        return { ok: false, error: detail.message ?? String(res.status), nextVoteAt: detail.next_vote_at };
      }
      return { ok: false, error: err.detail ?? String(res.status) };
    }
    const data = await res.json();
    return { ok: true, score: data.score, nextVoteAt: data.next_vote_at };
  } catch (e) {
    error('shared', 'castVote error:', e);
    return { ok: false, error: 'network_error' };
  }
}

export async function getAliases(): Promise<Record<string, string>> {
  const { aliases } = await getStored();
  return aliases ?? {};
}

export async function setAlias(
  login: string,
  alias: string,
): Promise<{ ok: boolean; error?: string }> {
  const normalizedLogin = login.toLowerCase().trim();
  const trimmedAlias = alias.trim();

  const { aliases } = await getStored();
  const next = { ...(aliases ?? {}) };
  if (!trimmedAlias || trimmedAlias.toLowerCase() === normalizedLogin) {
    delete next[normalizedLogin];
  } else {
    next[normalizedLogin] = trimmedAlias;
  }
  await browser.storage.local.set({ aliases: next });

  const token = await getValidToken();
  if (token) {
    try {
      const res = await fetch(`${BACKEND_URL}/aliases`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ target_login: normalizedLogin, alias: trimmedAlias }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        return { ok: false, error: err.detail ?? String(res.status) };
      }
    } catch { /* local saved, will sync later */ }
  }
  return { ok: true };
}

export async function deleteAlias(login: string): Promise<{ ok: boolean; error?: string }> {
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
    } catch { /* local removed, will sync later */ }
  }
  return { ok: true };
}

export async function exportAliases(): Promise<{
  data: Array<{ login: string; alias: string }>;
  count: number;
}> {
  const aliases = await getAliases();
  const data = Object.entries(aliases).map(([login, alias]) => ({ login, alias }));
  return { data, count: data.length };
}

export async function importAliases(
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

  const token = await getValidToken();
  if (token) {
    try {
      const payload = Object.entries(next).map(([login, alias]) => ({ target_login: login, alias }));
      const res = await fetch(`${BACKEND_URL}/aliases/import`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
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

export async function syncAliasesWithServer(): Promise<{ ok: boolean; error?: string }> {
  const token = await getValidToken();
  if (!token) return { ok: false, error: 'not_authenticated' };

  try {
    const res = await fetch(`${BACKEND_URL}/aliases`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      return { ok: false, error: err.detail ?? String(res.status) };
    }
    const serverData = (await res.json()) as Array<{ target_login: string; alias: string }>;

    const merged: Record<string, string> = {};
    for (const item of serverData) {
      if (item.target_login && item.alias) merged[item.target_login.toLowerCase()] = item.alias;
    }

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

    if (toPush.length > 0) {
      await fetch(`${BACKEND_URL}/aliases/import`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ aliases: toPush }),
      }).catch(() => {});
    }

    await browser.storage.local.set({ aliases: merged, aliasesSyncedAt: Date.now() });
    return { ok: true };
  } catch {
    return { ok: false, error: 'network_error' };
  }
}
