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

// ── Styles ────────────────────────────────────────────────────────────────────

const S: Record<string, React.CSSProperties> = {
  root: {
    width: 300,
    minHeight: 180,
    fontFamily: '"Inter", system-ui, -apple-system, sans-serif',
    fontSize: 13,
    background: '#0e0e10',
    color: '#efeff1',
    userSelect: 'none',
  },
  header: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: '11px 14px',
    background: '#18181b',
    borderBottom: '1px solid #2a2a2d',
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
    width: 22,
    height: 22,
    borderRadius: 5,
    flexShrink: 0,
  },
  version: { color: '#57575e', fontSize: 11 },
  body: { padding: '14px' },
  muted: { color: '#adadb8', fontSize: 12, marginBottom: 10, lineHeight: 1.5 },
  userRow: {
    display: 'flex',
    alignItems: 'center',
    gap: 9,
    padding: '10px 12px',
    background: '#18181b',
    borderRadius: 6,
    marginBottom: 10,
    border: '1px solid #2a2a2d',
  },
  avatar: {
    width: 30,
    height: 30,
    borderRadius: '50%',
    flexShrink: 0,
    overflow: 'hidden',
  },
  avatarFallback: {
    width: 30,
    height: 30,
    borderRadius: '50%',
    background: 'linear-gradient(135deg, #9147ff 0%, #6441a5 100%)',
    flexShrink: 0,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    fontSize: 13,
    fontWeight: 700,
    color: '#fff',
  },
  username: { fontWeight: 600, flex: 1, fontSize: 13 },
  channelBox: {
    background: '#18181b',
    borderRadius: 6,
    padding: '10px 12px',
    marginBottom: 10,
    border: '1px solid #2a2a2d',
  },
  channelMeta: { color: '#adadb8', fontSize: 11, marginBottom: 5, letterSpacing: '0.05em', textTransform: 'uppercase' as const },
  divider: { height: 1, background: '#2a2a2d', margin: '10px 0' },
  btn: {
    display: 'block',
    width: '100%',
    padding: '8px 12px',
    borderRadius: 5,
    border: 'none',
    cursor: 'pointer',
    fontWeight: 600,
    fontSize: 13,
    marginBottom: 6,
    textAlign: 'left' as const,
    transition: 'background 0.1s',
  },
  btnPrimary: { background: '#9147ff', color: '#fff' },
  btnGhost: { background: '#2a2a2d', color: '#efeff1' },
};

// ── Helpers ───────────────────────────────────────────────────────────────────

function ratingFg(score: number): string {
  if (score > 0) return '#00c853';
  if (score < 0) return '#ff4444';
  return '#adadb8';
}

function ratingText(score: number): string {
  if (score > 0) return `+${score}`;
  if (score < 0) return `${score}`;
  return '0';
}

function extractChannelLogin(url: string): string | null {
  try {
    const u = new URL(url);
    if (!u.hostname.includes('twitch.tv')) return null;
    const parts = u.pathname.split('/').filter(Boolean);
    const reserved = ['directory', 'search', 'following', 'subscriptions', 'inventory', 'wallet'];

    // /moderator/{channel} or /popout/moderator/{channel}
    const modIdx = parts.indexOf('moderator');
    if (modIdx !== -1 && parts[modIdx + 1]) return parts[modIdx + 1].toLowerCase();

    // /u/{channel} (dashboard)
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
        .catch((e: unknown) => { console.error('[TSR popup] GET_AUTH error', e); return ({ authenticated: false, userLogin: null, avatarUrl: null }); })) as AuthState;

      let channelLogin: string | null = null;
      try {
        const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
        if (tab?.url) channelLogin = extractChannelLogin(tab.url);
      } catch { /* noop */ }

      if (cancelled) return;

      setState((p) => ({
        ...p,
        auth: { ...auth, avatarUrl: (auth as AuthState).avatarUrl ?? null },
        loading: false,
        channelLogin,
        ratingLoading: auth.authenticated && channelLogin !== null,
      }));

      if (auth.authenticated && channelLogin) {
        const res = (await browser.runtime
          .sendMessage({ type: 'GET_USER_RATING', channelLogin })
          .catch((e: unknown) => { console.error('[TSR popup] GET_USER_RATING error', e); return null; })) as { score?: number } | null;
        if (cancelled) return;
        setState((p) => ({ ...p, channelRating: res?.score ?? null, ratingLoading: false }));
      }
    })();
    return () => { cancelled = true; };
  }, []);

  const handleLogin = async () => {
    setState((p) => ({ ...p, working: true }));
    const res = (await browser.runtime
      .sendMessage({ type: 'LOGIN' })
      .catch((e: unknown) => { console.error('[TSR popup] LOGIN error', e); return ({ success: false }); })) as { success: boolean; userLogin?: string };
    setState((p) => ({
      ...p,
      working: false,
      auth: res.success
        ? { authenticated: true, userLogin: res.userLogin ?? null, avatarUrl: null }
        : p.auth,
    }));
  };

  const handleLogout = async () => {
    await browser.runtime.sendMessage({ type: 'LOGOUT' }).catch((e: unknown) => { console.error('[TSR popup] LOGOUT error', e); });
    setState((p) => ({ ...p, auth: { authenticated: false, userLogin: null, avatarUrl: null }, channelRating: null }));
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
        <span style={S.version}>beta</span>
      </div>

      {/* Body */}
      <div style={S.body}>
        {loading ? (
          <p style={S.muted}>Загрузка…</p>
        ) : auth.authenticated ? (
          <>
            {/* User */}
            <div style={S.userRow}>
              {auth.avatarUrl ? (
                <img src={auth.avatarUrl} alt="" style={S.avatar} />
              ) : (
                <div style={S.avatarFallback}>{avatarLetter(auth.userLogin)}</div>
              )}
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={S.username}>{auth.userLogin}</div>
                <div style={{ color: '#57575e', fontSize: 11 }}>Авторизован</div>
              </div>
              {channelRating !== null && (
                <span style={{
                  fontWeight: 700,
                  fontFamily: 'monospace',
                  fontSize: 15,
                  color: ratingFg(channelRating),
                }}>
                  {ratingText(channelRating)}
                </span>
              )}
            </div>

            {/* Channel rating */}
            {channelLogin && (
              <div style={S.channelBox}>
                <div style={S.channelMeta}>
                  {channelLogin}
                </div>
                <div style={{
                  fontSize: 20,
                  fontWeight: 700,
                  fontFamily: 'monospace',
                  color: channelRating !== null ? ratingFg(channelRating) : '#adadb8',
                  lineHeight: 1.2,
                }}>
                  {ratingLoading ? '…' : channelRating !== null ? ratingText(channelRating) : '—'}
                </div>
                {!ratingLoading && (
                  <div style={{ color: '#57575e', fontSize: 11, marginTop: 3 }}>
                    твой рейтинг на этом канале
                  </div>
                )}
              </div>
            )}

            <div style={S.divider} />

            <button style={{ ...S.btn, ...S.btnGhost }} onClick={openProfile}>
              👤 Открыть профиль
            </button>
            <button style={{ ...S.btn, ...S.btnGhost }} onClick={handleLogout}>
              Выйти
            </button>
          </>
        ) : (
          <>
            <p style={S.muted}>
              Войдите чтобы ставить оценки чатерам на каналах Twitch.
            </p>
            <button
              style={{ ...S.btn, ...S.btnPrimary }}
              onClick={handleLogin}
              disabled={working}
            >
              {working ? 'Открываю Twitch…' : '🔐 Войти через Twitch'}
            </button>
            <p style={{ ...S.muted, fontSize: 11, marginTop: 8, marginBottom: 0 }}>
              Просматривать рейтинги можно без входа
            </p>
          </>
        )}
      </div>
    </div>
  );
}

createRoot(document.getElementById('root')!).render(<Popup />);
