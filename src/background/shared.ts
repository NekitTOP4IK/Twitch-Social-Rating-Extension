import browser from 'webextension-polyfill';
import { ActiveBadgeGrant, ChannelRoleItem } from '../types';
import { debug, error } from '../utils/logger';

declare const __BACKEND_URL__: string;
export const BACKEND_URL = __BACKEND_URL__;
const API_TIMEOUT_MS = 8_000;
const LOGOUT_TIMEOUT_MS = 5_000;
const RATING_CACHE_TTL_MS = 30_000;
const BADGE_GRANTS_CACHE_TTL_MS = 60_000;

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

type CardRating = { login: string; score: number; swag_score: number; social_score: number; isLowRating: boolean };

const ratingCache = new Map<string, { expiresAt: number; value: CardRating }>();
const ratingInflight = new Map<string, Promise<CardRating | null>>();
const badgeGrantCache = new Map<string, { expiresAt: number; value: ActiveBadgeGrant[] }>();
const badgeGrantInflight = new Map<string, Promise<ActiveBadgeGrant[]>>();

const CHANNEL_GRANTS_TTL_MS = 120_000; // 2 min
const channelGrantsMap = new Map<string, { expiresAt: number; byLogin: Map<string, ActiveBadgeGrant[]> }>();
const channelGrantsInflight = new Map<string, Promise<void>>();

function apiUrl(path: string): string {
  if (/^https?:\/\//i.test(path)) return path;
  return `${BACKEND_URL}${path.startsWith('/') ? path : `/${path}`}`;
}

function absoluteUrl(url: string | null): string | null {
  if (!url) return null;
  if (/^https?:\/\//i.test(url)) return url;
  return `${new URL(BACKEND_URL).origin}${url.startsWith('/') ? url : `/${url}`}`;
}

async function apiFetch(path: string, init: RequestInit = {}, timeoutMs = API_TIMEOUT_MS): Promise<Response> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(apiUrl(path), { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timeout);
  }
}

function ratingCacheKey(channelLogin: string, login: string): string {
  return `${channelLogin.trim().toLowerCase()}:${login.trim().toLowerCase()}`;
}

function setRatingCache(channelLogin: string, login: string, score: number): void {
  ratingCache.set(ratingCacheKey(channelLogin, login), {
    expiresAt: Date.now() + RATING_CACHE_TTL_MS,
    value: { login: login.toLowerCase(), score, swag_score: score, social_score: 0, isLowRating: score < 0 },
  });
}

function clearAuthCaches(): void {
  ratingCache.clear();
  ratingInflight.clear();
  badgeGrantCache.clear();
  badgeGrantInflight.clear();
  channelGrantsMap.clear();
  channelGrantsInflight.clear();
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
  clearAuthCaches();
  await browser.storage.local.remove([
    'accessToken', 'refreshToken', 'expiresAt', 'userLogin', 'avatarUrl',
  ]);
}

export async function logoutServer(): Promise<void> {
  const { refreshToken } = await getStored();
  if (refreshToken) {
    await apiFetch('/auth/logout', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refresh_token: refreshToken }),
    }, LOGOUT_TIMEOUT_MS).catch(() => {});
  }
  await clearTokens();
}

async function doRefresh(): Promise<string | null> {
  const { refreshToken: rt } = await getStored();
  debug('shared', 'doRefresh rt=', !!rt);
  if (!rt) return null;
  try {
    const res = await apiFetch('/auth/refresh', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refresh_token: rt }),
    });
    debug('shared', 'doRefresh res.ok=', res.ok, 'status=', res.status);
    if (res.status === 401) { await clearTokens(); return null; }
    if (!res.ok) return null;
    const data = await res.json();
    const expiresIn = Number(data.expires_in ?? 900);
    await browser.storage.local.set({
      accessToken: data.access_token,
      refreshToken: data.refresh_token,
      expiresAt: Date.now() + (Number.isFinite(expiresIn) && expiresIn > 0 ? expiresIn * 1000 : 900_000),
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

export async function refreshMe(): Promise<{ ok: boolean; avatarUrl?: string; login?: string; error?: string }> {
  const token = await getValidToken();
  debug('shared', 'refreshMe token=', !!token);
  if (!token) return { ok: false };
  try {
    const res = await apiFetch('/users/me', {
      headers: { Authorization: `Bearer ${token}` },
    });
    debug('shared', 'refreshMe res.ok=', res.ok, 'status=', res.status);
    if (!res.ok) {
      if (res.status === 401) {
        await clearTokens();
        return { ok: false, error: 'not_authenticated' };
      }
      return { ok: false, error: String(res.status) };
    }
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

export async function getUserRating(channelLogin: string): Promise<{ score?: number; swag_score?: number; social_score?: number } | null> {
  const { userLogin } = await getStored();
  if (!userLogin) return null;
  try {
    const url = `/ratings/${encodeURIComponent(channelLogin)}/${encodeURIComponent(userLogin)}`;
    const res = await apiFetch(url);
    if (!res.ok) {
      error('shared', 'getUserRating failed:', res.status, url);
      return null;
    }
    const data = await res.json();
    const swagScore = Number(data.swag_score ?? data.score ?? 0);
    const socialScore = Number(data.social_score ?? 0);
    return { score: swagScore, swag_score: swagScore, social_score: socialScore };
  } catch (e) {
    error('shared', 'getUserRating network error:', e);
    return null;
  }
}

export async function fetchRatingForCard(
  login: string,
  channelLogin: string,
): Promise<CardRating | null> {
  const key = ratingCacheKey(channelLogin, login);
  const cached = ratingCache.get(key);
  if (cached && cached.expiresAt > Date.now()) return cached.value;

  const existing = ratingInflight.get(key);
  if (existing) return existing;

  const request = (async (): Promise<CardRating | null> => {
    try {
      const url = `/ratings/${encodeURIComponent(channelLogin)}/${encodeURIComponent(login)}`;
      const res = await apiFetch(url);
      if (!res.ok) {
        error('shared', 'fetchRatingForCard failed:', res.status, url);
        return null;
      }
      const data = await res.json();
      if (data.enabled === false) return null;
      const score = Number(data.swag_score ?? data.score);
      const socialScore = Number(data.social_score ?? 0);
      if (typeof data.login !== 'string' || !Number.isSafeInteger(score)) return null;
      const value = { login: data.login, score, swag_score: score, social_score: socialScore, isLowRating: score < 0 };
      ratingCache.set(key, { expiresAt: Date.now() + RATING_CACHE_TTL_MS, value });
      return value;
    } catch (e) {
      error('shared', 'fetchRatingForCard network error:', e);
      return null;
    } finally {
      ratingInflight.delete(key);
    }
  })();

  ratingInflight.set(key, request);
  return request;
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
    const url = `/ratings/${encodeURIComponent(channelLogin)}/${encodeURIComponent(login)}/vote`;
    const res = await apiFetch(url, {
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
    const score = Number(data.swag_score ?? data.score);
    if (Number.isSafeInteger(score)) setRatingCache(channelLogin, login, score);
    return { ok: true, score, nextVoteAt: data.next_vote_at };
  } catch (e) {
    error('shared', 'castVote error:', e);
    return { ok: false, error: 'network_error' };
  }
}

export async function getChannelPermissions(channelLogin: string): Promise<{
  role: 'owner' | 'moderator' | 'global_admin' | null;
  can_manage_moderators: boolean;
  can_adjust_rating: boolean;
  allowed_modes: Array<'delta' | 'set'>;
} | null> {
  const token = await getValidToken();
  if (!token) return null;
  try {
    const res = await apiFetch(`/channels/${encodeURIComponent(channelLogin)}/me/permissions`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (res.status === 401) {
      await clearTokens();
      return null;
    }
    if (!res.ok) return null;
    return await res.json();
  } catch (e) {
    error('shared', 'getChannelPermissions error:', e);
    return null;
  }
}

export async function adjustChannelRating(
  channelLogin: string,
  login: string,
  value: number,
  mode: 'delta' | 'set' = 'delta',
): Promise<{ ok: boolean; score?: number; error?: string }> {
  const token = await getValidToken();
  if (!token) return { ok: false, error: 'not_authenticated' };
  try {
    const res = await apiFetch(`/channels/${encodeURIComponent(channelLogin)}/ratings/${encodeURIComponent(login)}/adjust`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ value, mode }),
    });
    if (res.status === 401) {
      await clearTokens();
      return { ok: false, error: 'not_authenticated' };
    }
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      return { ok: false, error: err.detail ?? String(res.status) };
    }
    const data = await res.json();
    const score = Number(data.swag_score ?? data.score);
    if (Number.isSafeInteger(score)) setRatingCache(channelLogin, login, score);
    return { ok: true, score };
  } catch (e) {
    error('shared', 'adjustChannelRating error:', e);
    return { ok: false, error: 'network_error' };
  }
}

export async function fetchBadgeGrants(
  channelLogin: string,
  logins: string[],
): Promise<ActiveBadgeGrant[]> {
  const normalizedLogins = Array.from(new Set(logins.map((login) => login.trim().toLowerCase()).filter(Boolean))).sort();
  if (normalizedLogins.length === 0) return [];
  const key = `${channelLogin.trim().toLowerCase()}:${normalizedLogins.join(',')}`;
  const cached = badgeGrantCache.get(key);
  if (cached && cached.expiresAt > Date.now()) return cached.value;
  const existing = badgeGrantInflight.get(key);
  if (existing) return existing;

  const request = (async (): Promise<ActiveBadgeGrant[]> => {
    try {
      const params = new URLSearchParams({ users: normalizedLogins.join(',') });
      const res = await apiFetch(`/channels/${encodeURIComponent(channelLogin)}/badge-grants?${params.toString()}`);
      if (!res.ok) return [];
      const data = await res.json();
      if (!Array.isArray(data)) return [];
      const grants = data
        .filter((item) => typeof item?.login === 'string' && (item.kind === 'high' || item.kind === 'low') && Number.isSafeInteger(item.rank))
        .map((item) => ({
          login: item.login.toLowerCase(),
          kind: item.kind,
          rank: item.rank,
          image_url: absoluteUrl(typeof item.image_url === 'string' ? item.image_url : null),
          title: typeof item.title === 'string' ? item.title : `Топ-${item.rank} чатер на канале`,
          period_label: typeof item.period_label === 'string' ? item.period_label : '',
        })) as ActiveBadgeGrant[];
      badgeGrantCache.set(key, { expiresAt: Date.now() + BADGE_GRANTS_CACHE_TTL_MS, value: grants });
      return grants;
    } catch (e) {
      error('shared', 'fetchBadgeGrants error:', e);
      return [];
    } finally {
      badgeGrantInflight.delete(key);
    }
  })();

  badgeGrantInflight.set(key, request);
  return request;
}

export async function prefetchChannelBadgeGrants(channelLogin: string): Promise<void> {
  const key = channelLogin.trim().toLowerCase();
  const cached = channelGrantsMap.get(key);
  if (cached && cached.expiresAt > Date.now()) return;

  const existing = channelGrantsInflight.get(key);
  if (existing) return existing;

  const request = (async (): Promise<void> => {
    try {
      const res = await apiFetch(`/channels/${encodeURIComponent(channelLogin)}/badge-grants`);
      if (!res.ok) return;
      const data = await res.json();
      if (!Array.isArray(data)) return;
      const byLogin = new Map<string, ActiveBadgeGrant[]>();
      for (const item of data) {
        if (typeof item?.login !== 'string') continue;
        if (item.kind !== 'high' && item.kind !== 'low') continue;
        if (!Number.isSafeInteger(item.rank)) continue;
        const grant: ActiveBadgeGrant = {
          login: item.login.toLowerCase(),
          kind: item.kind,
          rank: item.rank,
          image_url: absoluteUrl(typeof item.image_url === 'string' ? item.image_url : null),
          title: typeof item.title === 'string' ? item.title : `Топ-${item.rank} чатер на канале`,
          period_label: typeof item.period_label === 'string' ? item.period_label : '',
        };
        const existing = byLogin.get(grant.login) ?? [];
        existing.push(grant);
        byLogin.set(grant.login, existing);
      }
      channelGrantsMap.set(key, { expiresAt: Date.now() + CHANNEL_GRANTS_TTL_MS, byLogin });
    } catch (e) {
      error('shared', 'prefetchChannelBadgeGrants error:', e);
    } finally {
      channelGrantsInflight.delete(key);
    }
  })();

  channelGrantsInflight.set(key, request);
  return request;
}

export function getChannelGrantsForLogin(channelLogin: string, login: string): ActiveBadgeGrant[] {
  const key = channelLogin.trim().toLowerCase();
  const cached = channelGrantsMap.get(key);
  if (!cached || cached.expiresAt <= Date.now()) return [];
  return cached.byLogin.get(login.trim().toLowerCase()) ?? [];
}

export async function getOrFetchChannelGrantsForLogin(
  channelLogin: string,
  login: string,
): Promise<ActiveBadgeGrant[]> {
  await prefetchChannelBadgeGrants(channelLogin);
  return getChannelGrantsForLogin(channelLogin, login);
}

export function invalidateChannelBadgeGrants(channelLogin?: string): void {
  if (!channelLogin) {
    badgeGrantCache.clear();
    badgeGrantInflight.clear();
    channelGrantsMap.clear();
    channelGrantsInflight.clear();
    return;
  }

  const key = channelLogin.trim().toLowerCase();
  channelGrantsMap.delete(key);
  channelGrantsInflight.delete(key);
  for (const cacheKey of Array.from(badgeGrantCache.keys())) {
    if (cacheKey.startsWith(`${key}:`)) badgeGrantCache.delete(cacheKey);
  }
  for (const inflightKey of Array.from(badgeGrantInflight.keys())) {
    if (inflightKey.startsWith(`${key}:`)) badgeGrantInflight.delete(inflightKey);
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
      const res = await apiFetch('/aliases', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ target_login: normalizedLogin, alias: trimmedAlias }),
      });
      if (!res.ok) {
        if (res.status === 401) {
          await clearTokens();
          return { ok: false, error: 'not_authenticated' };
        }
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
      const res = await apiFetch(`/aliases/${encodeURIComponent(normalizedLogin)}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.status === 401) {
        await clearTokens();
        return { ok: false, error: 'not_authenticated' };
      }
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
      const res = await apiFetch('/aliases/import', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ aliases: payload }),
      });
      if (!res.ok) {
        if (res.status === 401) {
          await clearTokens();
          return { ok: false, error: 'not_authenticated', imported };
        }
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
    const res = await apiFetch('/aliases', {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) {
      if (res.status === 401) {
        await clearTokens();
        return { ok: false, error: 'not_authenticated' };
      }
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
      await apiFetch('/aliases/import', {
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

export async function getChannelModerators(channelLogin: string): Promise<ChannelRoleItem[] | null> {
  const token = await getValidToken();
  if (!token) return null;
  try {
    const res = await apiFetch(`/channels/${encodeURIComponent(channelLogin)}/moderators`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (res.status === 401) { await clearTokens(); return null; }
    if (!res.ok) return null;
    return await res.json() as ChannelRoleItem[];
  } catch (e) {
    error('shared', 'getChannelModerators error:', e);
    return null;
  }
}

export async function addChannelModerator(channelLogin: string, targetLogin: string): Promise<{ ok: boolean; error?: string }> {
  const token = await getValidToken();
  if (!token) return { ok: false, error: 'not_authenticated' };
  try {
    const res = await apiFetch(`/channels/${encodeURIComponent(channelLogin)}/moderators`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ login: targetLogin, role: 'moderator' }),
    });
    if (res.status === 401) { await clearTokens(); return { ok: false, error: 'not_authenticated' }; }
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      return { ok: false, error: err.detail ?? String(res.status) };
    }
    return { ok: true };
  } catch (e) {
    error('shared', 'addChannelModerator error:', e);
    return { ok: false, error: 'network_error' };
  }
}

export async function removeChannelModerator(channelLogin: string, targetLogin: string): Promise<{ ok: boolean; error?: string }> {
  const token = await getValidToken();
  if (!token) return { ok: false, error: 'not_authenticated' };
  try {
    const res = await apiFetch(`/channels/${encodeURIComponent(channelLogin)}/moderators/${encodeURIComponent(targetLogin)}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${token}` },
    });
    if (res.status === 401) { await clearTokens(); return { ok: false, error: 'not_authenticated' }; }
    if (!res.ok && res.status !== 404) {
      const err = await res.json().catch(() => ({}));
      return { ok: false, error: err.detail ?? String(res.status) };
    }
    return { ok: true };
  } catch (e) {
    error('shared', 'removeChannelModerator error:', e);
    return { ok: false, error: 'network_error' };
  }
}
