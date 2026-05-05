import React, { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import browser from 'webextension-polyfill';

interface AuthState {
  authenticated: boolean;
  userLogin: string | null;
  avatarUrl: string | null;
}

interface PopupState {
  auth: AuthState;
  loading: boolean;
  working: boolean;
  channelLogin: string | null;
  channelRating: number | null;
  ratingLoading: boolean;
}

// ── Design tokens ─────────────────────────────────────────────────────────────

const C = {
  bg: '#0e0e10',
  surface: '#18181b',
  border: '#2a2a2d',
  borderStrong: '#3a3a3d',
  text: '#efeff1',
  textSub: '#adadb8',
  textMuted: '#57575e',
  purple: '#9147ff',
  green: '#00b341',
  ratingPos: '#00c853',
  ratingNeg: '#ff4444',
};

const S: Record<string, React.CSSProperties> = {
  root: {
    width: 300,
    fontFamily: '"Inter", system-ui, -apple-system, sans-serif',
    background: C.bg,
    color: C.text,
    userSelect: 'none',
  },
  header: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: '10px 14px',
    background: C.surface,
    borderBottom: `1px solid ${C.border}`,
  },
  brand: {
    display: 'flex',
    alignItems: 'center',
    gap: 7,
    fontWeight: 700,
    fontSize: 13,
    letterSpacing: '-0.01em',
  },
  brandIcon: {
    width: 20,
    height: 20,
    borderRadius: 4,
    flexShrink: 0,
  },
  betaBadge: {
    fontSize: 10,
    fontWeight: 700,
    letterSpacing: '0.06em',
    textTransform: 'uppercase' as const,
    color: C.textMuted,
    background: '#26262c',
    padding: '2px 6px',
    borderRadius: 3,
  },
  body: {
    padding: '12px 14px',
    display: 'flex',
    flexDirection: 'column' as const,
    gap: 10,
  },
  // ── User row ────────────────────────────────────────────────────────────────
  userRow: {
    display: 'flex',
    alignItems: 'center',
    gap: 9,
  },
  avatar: {
    width: 30,
    height: 30,
    borderRadius: '50%',
    flexShrink: 0,
  },
  avatarFallback: {
    width: 30,
    height: 30,
    borderRadius: '50%',
    background: C.purple,
    flexShrink: 0,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    fontSize: 12,
    fontWeight: 700,
    color: '#fff',
  },
  userMeta: {
    flex: 1,
    minWidth: 0,
  },
  username: {
    fontSize: 13,
    fontWeight: 600,
    color: C.text,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap' as const,
    lineHeight: 1.3,
  },
  userStatus: {
    display: 'flex',
    alignItems: 'center',
    gap: 4,
    marginTop: 2,
    fontSize: 10,
    color: C.textMuted,
    lineHeight: 1,
  },
  statusDot: {
    width: 5,
    height: 5,
    borderRadius: '50%',
    background: C.green,
    flexShrink: 0,
  },
  // ── Rating card ─────────────────────────────────────────────────────────────
  ratingCard: {
    background: C.surface,
    borderRadius: 4,
    borderTop: `1px solid ${C.border}`,
    borderRight: `1px solid ${C.border}`,
    borderBottom: `1px solid ${C.border}`,
    borderLeft: `3px solid ${C.borderStrong}`,
    padding: '10px 12px',
  },
  ratingLabel: {
    fontSize: 10,
    fontWeight: 700,
    letterSpacing: '0.06em',
    textTransform: 'uppercase' as const,
    color: C.textMuted,
    marginBottom: 6,
    lineHeight: 1,
  },
  ratingChannel: {
    fontSize: 12,
    fontWeight: 600,
    color: C.textSub,
    marginBottom: 8,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap' as const,
  },
  ratingNumber: {
    fontSize: 30,
    fontWeight: 800,
    lineHeight: 1,
    letterSpacing: '-0.03em',
    color: C.textMuted,
    marginBottom: 3,
  },
  ratingSubtext: {
    fontSize: 11,
    color: C.textMuted,
    lineHeight: 1,
  },
  // ── No channel hint ─────────────────────────────────────────────────────────
  noChannel: {
    fontSize: 12,
    color: C.textMuted,
    textAlign: 'center' as const,
    padding: '4px 0',
    lineHeight: 1.5,
  },
  // ── Actions ─────────────────────────────────────────────────────────────────
  actions: {
    display: 'flex',
    gap: 6,
  },
  btnGhost: {
    flex: 1,
    padding: '7px 8px',
    borderRadius: 4,
    border: `1px solid ${C.border}`,
    background: 'transparent',
    color: C.textSub,
    cursor: 'pointer',
    fontWeight: 600,
    fontSize: 12,
    fontFamily: 'inherit',
    textAlign: 'center' as const,
  },
  // ── Login state ─────────────────────────────────────────────────────────────
  loginWrap: {
    display: 'flex',
    flexDirection: 'column' as const,
    gap: 12,
    padding: '4px 0',
  },
  loginText: {
    fontSize: 13,
    color: C.textSub,
    lineHeight: 1.55,
    margin: 0,
  },
  btnPrimary: {
    display: 'block',
    width: '100%',
    padding: '9px 12px',
    borderRadius: 4,
    border: 'none',
    background: C.purple,
    color: '#fff',
    cursor: 'pointer',
    fontWeight: 700,
    fontSize: 13,
    fontFamily: 'inherit',
    textAlign: 'center' as const,
    boxSizing: 'border-box' as const,
  },
  loginNote: {
    fontSize: 11,
    color: C.textMuted,
    textAlign: 'center' as const,
    lineHeight: 1.5,
    margin: 0,
  },
};

// ── Helpers ───────────────────────────────────────────────────────────────────

function ratingFg(score: number): string {
  if (score > 0) return C.ratingPos;
  if (score < 0) return C.ratingNeg;
  return C.textSub;
}

function ratingBorderColor(score: number): string {
  if (score > 0) return C.ratingPos;
  if (score < 0) return C.ratingNeg;
  return C.borderStrong;
}

function ratingText(score: number): string {
  if (score > 0) return `+${score}`;
  return `${score}`;
}

function extractChannelLogin(url: string): string | null {
  try {
    const u = new URL(url);
    if (!u.hostname.includes('twitch.tv')) return null;
    const parts = u.pathname.split('/').filter(Boolean);
    const reserved = ['directory', 'search', 'following', 'subscriptions', 'inventory', 'wallet'];
    const modIdx = parts.indexOf('moderator');
    if (modIdx !== -1 && parts[modIdx + 1]) return parts[modIdx + 1].toLowerCase();
    const uIdx = parts.indexOf('u');
    if (uIdx !== -1 && parts[uIdx + 1]) return parts[uIdx + 1].toLowerCase();
    if (parts.length > 0 && !reserved.includes(parts[0])) return parts[0].toLowerCase();
  } catch { /* noop */ }
  return null;
}

function avatarLetter(login: string | null): string {
  return login ? login[0].toUpperCase() : '?';
}

// ── Component ─────────────────────────────────────────────────────────────────

function Popup() {
  const [state, setState] = useState<PopupState>({
    auth: { authenticated: false, userLogin: null, avatarUrl: null },
    loading: true,
    working: false,
    channelLogin: null,
    channelRating: null,
    ratingLoading: false,
  });

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const auth = (await browser.runtime
        .sendMessage({ type: 'GET_AUTH' })
        .catch(() => ({ authenticated: false, userLogin: null, avatarUrl: null }))) as AuthState;

      let channelLogin: string | null = null;
      try {
        const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
        if (tab?.url) channelLogin = extractChannelLogin(tab.url);
      } catch { /* noop */ }

      if (cancelled) return;

      setState((p) => ({
        ...p,
        auth,
        loading: false,
        channelLogin,
        ratingLoading: auth.authenticated && channelLogin !== null,
      }));

      if (auth.authenticated && channelLogin) {
        const res = (await browser.runtime
          .sendMessage({ type: 'GET_USER_RATING', channelLogin })
          .catch(() => null)) as { score?: number } | null;
        if (cancelled) return;
        setState((p) => ({ ...p, channelRating: res?.score ?? null, ratingLoading: false }));
      }
    })();
    return () => { cancelled = true; };
  }, []);

  const handleLogin = async () => {
    setState((p) => ({ ...p, working: true }));
    await browser.runtime.sendMessage({ type: 'LOGIN' }).catch(() => ({ success: false }));
    // Re-fetch to get full auth state including avatarUrl stored during OAuth
    const auth = (await browser.runtime
      .sendMessage({ type: 'GET_AUTH' })
      .catch(() => ({ authenticated: false, userLogin: null, avatarUrl: null }))) as AuthState;
    setState((p) => ({ ...p, working: false, auth }));
  };

  const handleLogout = async () => {
    await browser.runtime.sendMessage({ type: 'LOGOUT' }).catch(() => {});
    setState((p) => ({
      ...p,
      auth: { authenticated: false, userLogin: null, avatarUrl: null },
      channelRating: null,
    }));
  };

  const openProfile = () => {
    if (state.auth.userLogin)
      browser.tabs.create({ url: `https://socialrating.app/profile/${state.auth.userLogin}` });
  };

  const { auth, loading, working, channelLogin, channelRating, ratingLoading } = state;

  return (
    <div style={S.root}>
      {/* Header */}
      <div style={S.header}>
        <div style={S.brand}>
          <img src="icon.png" alt="" style={S.brandIcon} />
          <span>Social Rating</span>
        </div>
        <span style={S.betaBadge}>beta</span>
      </div>

      {/* Body */}
      <div style={S.body}>
        {loading ? (
          <div style={{ fontSize: 12, color: C.textMuted, padding: '6px 0' }}>Загрузка…</div>
        ) : auth.authenticated ? (
          <>
            {/* User row */}
            <div style={S.userRow}>
              {auth.avatarUrl ? (
                <img src={auth.avatarUrl} alt="" style={S.avatar} />
              ) : (
                <div style={S.avatarFallback}>{avatarLetter(auth.userLogin)}</div>
              )}
              <div style={S.userMeta}>
                <div style={S.username}>{auth.userLogin}</div>
                <div style={S.userStatus}>
                  <div style={S.statusDot} />
                  Авторизован
                </div>
              </div>
            </div>

            {/* Channel rating card */}
            {channelLogin ? (
              <div style={{
                ...S.ratingCard,
                borderLeftColor: channelRating !== null
                  ? ratingBorderColor(channelRating)
                  : C.borderStrong,
              }}>
                <div style={S.ratingLabel}>Рейтинг</div>
                <div style={S.ratingChannel}>{channelLogin}</div>
                <div style={{
                  ...S.ratingNumber,
                  color: channelRating !== null ? ratingFg(channelRating) : C.textMuted,
                }}>
                  {ratingLoading
                    ? '—'
                    : channelRating !== null
                      ? ratingText(channelRating)
                      : '—'}
                </div>
                <div style={S.ratingSubtext}>
                  {ratingLoading ? 'Загрузка…' : 'твой рейтинг на канале'}
                </div>
              </div>
            ) : (
              <div style={S.noChannel}>Откройте канал на Twitch</div>
            )}

            {/* Actions */}
            <div style={S.actions}>
              <button style={S.btnGhost} onClick={openProfile}>Профиль</button>
              <button style={S.btnGhost} onClick={handleLogout}>Выйти</button>
            </div>
          </>
        ) : (
          <div style={S.loginWrap}>
            <p style={S.loginText}>
              Войдите чтобы ставить оценки чатерам на каналах Twitch.
            </p>
            <button style={S.btnPrimary} onClick={handleLogin} disabled={working}>
              {working ? 'Открываю Twitch…' : 'Войти через Twitch'}
            </button>
            <p style={S.loginNote}>
              Просматривать рейтинги можно без входа
            </p>
          </div>
        )}
      </div>
    </div>
  );
}

createRoot(document.getElementById('root')!).render(<Popup />);
