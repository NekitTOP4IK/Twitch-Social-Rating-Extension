import browser from 'webextension-polyfill';
import { debug } from '../utils/logger';
import {
  BACKEND_URL,
  getStored, storeTokens, clearTokens,
  getUserRating, fetchRatingForCard, castVote,
  getAliases, setAlias, deleteAlias, exportAliases, importAliases, syncAliasesWithServer,
} from './shared';

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

async function login(): Promise<{ success: boolean; userLogin?: string }> {
  const redirectUri = browser.identity.getRedirectURL('callback');
  const authUrl =
    `${BACKEND_URL}/auth/twitch` +
    `?extension_redirect_uri=${encodeURIComponent(redirectUri)}`;

  try {
    const responseUrl = await browser.identity.launchWebAuthFlow({ url: authUrl, interactive: true });
    const url = new URL(responseUrl);
    const params = new URLSearchParams(url.hash ? url.hash.slice(1) : url.search.slice(1));

    const accessToken = params.get('access_token');
    const refreshToken = params.get('refresh_token');
    if (!accessToken || !refreshToken) return { success: false };

    const userLogin = params.get('login') ?? undefined;
    const avatarUrl = params.get('avatar_url') ?? undefined;
    const expiresIn = parseInt(params.get('expires_in') ?? '900', 10);

    await storeTokens(accessToken, refreshToken, userLogin, avatarUrl, expiresIn);
    await syncAliasesWithServer();

    return { success: true, userLogin };
  } catch {
    return { success: false };
  }
}

browser.runtime.onMessage.addListener((message: unknown): Promise<unknown> | undefined => {
  const msg = message as Message;
  debug('BG', 'received message:', msg.type, msg);
  switch (msg.type) {
    case 'GET_AUTH':
      return getStored().then(({ accessToken, userLogin, avatarUrl }) => {
        const result = { authenticated: !!accessToken, userLogin: userLogin ?? null, avatarUrl: avatarUrl ?? null };
        debug('BG', 'GET_AUTH ->', result);
        return result;
      });
    case 'LOGIN':
      debug('BG', 'LOGIN start');
      return login().then((r) => { debug('BG', 'LOGIN ->', r); return r; });
    case 'LOGOUT':
      return clearTokens().then(() => ({ success: true }));
    case 'GET_USER_RATING':
      debug('BG', 'GET_USER_RATING channel=', msg.channelLogin);
      return getUserRating(msg.channelLogin).then((r) => { debug('BG', 'GET_USER_RATING ->', r); return r; });
    case 'FETCH_RATING':
      debug('BG', 'FETCH_RATING login=', msg.login, 'channel=', msg.channelLogin);
      return fetchRatingForCard(msg.login, msg.channelLogin).then((r) => { debug('BG', 'FETCH_RATING ->', r); return r; });
    case 'CAST_VOTE':
      return castVote(msg.login, msg.channelLogin, msg.value);
    case 'GET_ALIASES':
      return getAliases().then((aliases) => ({ aliases }));
    case 'SET_ALIAS':
      return setAlias(msg.login, msg.alias);
    case 'DELETE_ALIAS':
      return deleteAlias(msg.login);
    case 'EXPORT_ALIASES':
      return exportAliases();
    case 'IMPORT_ALIASES':
      return importAliases(msg.data);
    case 'SYNC_ALIASES':
      return syncAliasesWithServer();
    default:
      debug('BG', 'unknown message type:', (msg as any).type);
      return undefined;
  }
});

(async () => {
  const { accessToken } = await getStored();
  if (accessToken) await syncAliasesWithServer().catch(() => {});
})();
