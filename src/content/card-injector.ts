import browser from 'webextension-polyfill';
import { DetectedCard } from './card-detector';
import { ChannelPermissions, RatingData } from '../types';

declare const __FRONTEND_URL__: string;

const BADGE_ATTR = 'data-tsr-badge';
const SCORE_ATTR = 'data-tsr-score';
const LABEL_ATTR = 'data-tsr-label';
const CHANNEL_ATTR = 'data-tsr-channel';

// ── Style injection ───────────────────────────────────────────────────────────

function ensureBadgeStyle(): void {
  if (document.getElementById('tsr-badge-style')) return;
  const style = document.createElement('style');
  style.id = 'tsr-badge-style';
  style.textContent = `
    [data-tsr-badge] {
      box-sizing: border-box;
      display: flex;
      flex-direction: column;
      grid-column: 1 / -1;
      gap: 5px;
      padding: 8px 12px 8px 15px;
      background: #0e0e10;
      border-top: 1px solid #1f1f23;
      position: relative;
      flex-shrink: 0;
      overflow: hidden;
      width: 100%;
    }
    [data-tsr-badge] .tsr-stripe {
      position: absolute;
      left: 0; top: 0; bottom: 0;
      width: 3px;
      pointer-events: none;
    }
    [data-tsr-badge] .tsr-row {
      display: flex;
      align-items: center;
      gap: 6px;
      position: relative;
      z-index: 1;
    }
    [data-tsr-badge] [data-tsr-label] {
      display: flex;
      align-items: center;
      gap: 4px;
      font-size: 9px;
      font-weight: 700;
      letter-spacing: 0.1em;
      text-transform: uppercase;
      line-height: 1;
      flex: 1;
    }
    [data-tsr-badge] .tsr-link {
      font-size: 11px;
      font-weight: 500;
      color: #57575e;
      text-decoration: none;
      flex-shrink: 0;
      transition: color 0.12s;
    }
    [data-tsr-badge] .tsr-link:hover { color: #adadb8; }
    [data-tsr-badge] [data-tsr-score] {
      font-size: 26px;
      font-weight: 700;
      font-family: ui-monospace, 'SF Mono', 'Cascadia Mono', Consolas, 'Courier New', monospace;
      font-variant-numeric: tabular-nums;
      line-height: 1;
      flex: 1;
    }
    [data-tsr-badge] .tsr-vote-btn {
      border-radius: 0;
      height: 24px;
      width: 24px;
      padding: 0;
      font-size: 12px;
      font-weight: 700;
      cursor: pointer;
      user-select: none;
      display: flex;
      align-items: center;
      justify-content: center;
      flex-shrink: 0;
      background: transparent;
      transition: background 0.12s, border-color 0.12s;
    }
    [data-tsr-badge] .tsr-vote-btn:disabled { opacity: 0.4; cursor: default; }
    [data-tsr-badge] [data-tsr-toast] {
      font-size: 11px;
      font-weight: 600;
      line-height: 1.4;
      word-break: break-word;
      position: relative;
      z-index: 1;
    }
  `;
  document.head.appendChild(style);
}

// ── 7TV CSS fix ───────────────────────────────────────────────────────────────

function ensureSeventvStyle(): void {
  if (document.getElementById('tsr-seventv-style')) return;
  const style = document.createElement('style');
  style.id = 'tsr-seventv-style';
  // Without explicit height, the card's 1fr data row doesn't shrink when the
  // header grows — causing the message list to overflow the card boundary.
  style.textContent = `
    .seventv-user-card-container:has([data-tsr-badge]) .seventv-user-card {
      max-height: 80vh !important;
      overflow: hidden !important;
    }
    .seventv-user-card-container:has([data-tsr-badge]) .seventv-user-card-data {
      min-height: 0 !important;
      overflow: hidden !important;
    }
    .seventv-user-card-container:has([data-tsr-badge]) .seventv-user-card-data .scrollable-container {
      min-height: 0 !important;
      overflow-y: auto !important;
    }
    .seventv-user-card-container:has([data-tsr-badge]) .seventv-user-card-interactive {
      grid-template-rows: auto auto auto auto !important;
      grid-template-areas: "metrics" "actions" "tsr-rating" "mod" !important;
    }
  `;
  document.head.appendChild(style);
}

// ── Label helpers ─────────────────────────────────────────────────────────────

const WARN_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" style="flex-shrink:0;vertical-align:middle"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>`;

const PENCIL_SVG = `<svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
  <rect x="1" y="1" width="22" height="22" rx="3" stroke="white" stroke-width="1.2" fill="none"/>
  <path
    d="M4.5 19.5L8.2 18.7L18.8 8.1L15.9 5.2L5.3 15.8L4.5 19.5Z"
    stroke="white"
    stroke-width="1.2"
    stroke-linecap="round"
    stroke-linejoin="round"
  />
  <path
    d="M13.2 7.9L16.1 10.8"
    stroke="white"
    stroke-width="1.2"
    stroke-linecap="round"
  />
  <path
    d="M5.7 16.2L7.8 18.3"
    stroke="white"
    stroke-width="1"
    stroke-linecap="round"
  />
</svg>`;

const PLUS_ONE_SVG = `<svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
  <rect x="1" y="1" width="22" height="22" rx="3" stroke="#0FEE9F" stroke-width="1.2" fill="none"/>
  <text x="12" y="12" font-family="sans-serif" font-size="12" font-weight="bold" fill="#0FEE9F" text-anchor="middle" dominant-baseline="central">+1</text>
</svg>`;

const MINUS_ONE_SVG = `<svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
  <rect x="1" y="1" width="22" height="22" rx="3" stroke="#EC5B5B" stroke-width="1.2" fill="none"/>
  <text x="12" y="12" font-family="sans-serif" font-size="12" font-weight="bold" fill="#EC5B5B" text-anchor="middle" dominant-baseline="central">-1</text>
</svg>`;

function swordSvg(strokeColor: string) {
  return `<svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
  <rect x="1" y="1" width="22" height="22" rx="3" stroke="${strokeColor}" stroke-width="1.2" fill="none"/>
  <g transform="translate(12,12) scale(0.66) translate(-18,-18)">
    <g transform="rotate(45 18 18)">
      <path fill="none" stroke="${strokeColor}" stroke-width="1.2" d="
        M14 6
        L18 1.8
        L22 6
        L21 22
        H15
        Z
      "/>
      <rect x="10" y="21" width="16" height="3.5" rx="1" fill="none" stroke="${strokeColor}" stroke-width="1.2"/>
      <rect x="16" y="24" width="4" height="7" rx="1" fill="none" stroke="${strokeColor}" stroke-width="1.2"/>
    </g>
  </g>
</svg>`;
}

function labelText(channel: string, isLow: boolean): string {
  const prefix = channel ? `${channel} / ` : '';
  return `${prefix}${isLow ? 'Низкий рейтинг' : 'Социальный рейтинг'}`;
}

function setLabel(el: HTMLElement, channel: string, isLow: boolean): void {
  el.style.color = isLow ? '#ff5252' : '#57575e';
  el.innerHTML = isLow
    ? `${WARN_SVG}<span>${labelText(channel, true)}</span>`
    : `<span>${labelText(channel, false)}</span>`;
}

// ── Score helpers ─────────────────────────────────────────────────────────────

function scoreFg(score: number): string {
  if (score > 0) return '#00e676';
  if (score < 0) return '#ff5252';
  return '#adadb8';
}

function scoreAccent(score: number): string {
  if (score > 0) return '#00e676';
  if (score < 0) return '#ff5252';
  return '#3a3a3d';
}

function scoreText(score: number): string {
  if (score > 0) return `+${score}`;
  return `${score}`;
}

function formatNextVoteDate(ts: number): string {
  return new Date(ts).toLocaleDateString('ru-RU', {
    day: 'numeric', month: 'short', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
  });
}

function formatVoteError(error: string, nextVoteAt?: number): string {
  if (error.includes('24 hours') || error === '429') {
    const ts = nextVoteAt ? nextVoteAt * 1000 : Date.now() + 86400000;
    return `Подожди! Следующее голосование ${formatNextVoteDate(ts)}`;
  }
  if (error.includes('yourself')) return 'Нельзя голосовать за себя';
  if (error.includes('below zero')) return 'Твой рейтинг < 0 — голосование заблокировано';
  if (error === 'not_authenticated') return 'Не авторизован — войди через иконку расширения';
  if (error === 'network_error') return 'Ошибка сети';
  return error.length < 80 ? error : 'Ошибка голосования';
}

function showToast(container: HTMLElement, text: string, type: 'ok' | 'warn' | 'err'): void {
  container.querySelector('[data-tsr-toast]')?.remove();
  const el = document.createElement('div');
  el.setAttribute('data-tsr-toast', '');
  el.style.color = type === 'ok' ? '#00e676' : type === 'warn' ? '#ffb300' : '#ff5252';
  el.textContent = text;
  container.appendChild(el);
  const t = setTimeout(() => el.remove(), 3500);
  el.addEventListener('click', () => { clearTimeout(t); el.remove(); });
}

function makeVoteBtn(label: string, tint: string): HTMLButtonElement {
  const btn = document.createElement('button');
  btn.className = 'tsr-vote-btn';
  btn.innerHTML = label;
  btn.style.cssText = `border:1px solid ${tint}50;color:${tint};`;
  btn.addEventListener('mouseover', () => {
    if (btn.disabled) return;
    btn.style.background = `${tint}20`;
    btn.style.borderColor = tint;
  });
  btn.addEventListener('mouseout', () => {
    if (btn.disabled) return;
    btn.style.background = 'transparent';
    btn.style.borderColor = `${tint}50`;
  });
  return btn;
}

function makeIconBtn(label: string, tint: string): HTMLButtonElement {
  const btn = makeVoteBtn(label, tint);
  btn.style.padding = '0 6px';
  btn.style.fontSize = '14px';
  return btn;
}

const permissionCache = new Map<string, Promise<ChannelPermissions | null>>();

function getChannelPermissions(channelLogin: string): Promise<ChannelPermissions | null> {
  if (!channelLogin) return Promise.resolve(null);
  const cached = permissionCache.get(channelLogin);
  if (cached) return cached;
  const promise = browser.runtime
    .sendMessage({ type: 'GET_CHANNEL_PERMISSIONS', channelLogin })
    .then((res) => (res as ChannelPermissions | null) ?? null)
    .catch(() => null);
  permissionCache.set(channelLogin, promise);
  return promise;
}

async function getChannelModerators(channelLogin: string): Promise<Array<{ login: string; role: string }> | null> {
  if (!channelLogin) return null;
  try {
    return await browser.runtime.sendMessage({ type: 'GET_CHANNEL_MODERATORS', channelLogin }) as Array<{ login: string; role: string }> | null;
  } catch { return null; }
}

// ── Injection target ──────────────────────────────────────────────────────────

function findTarget(card: DetectedCard): { el: Element; how: 'append' | 'insertAfter' | 'insertBefore'; gridArea?: string } | null {
  if (card.type === 'seventv') {
    ensureSeventvStyle();
    const interactive = card.element.querySelector('.seventv-user-card-interactive');
    if (interactive) return { el: interactive, how: 'append', gridArea: 'tsr-rating' };
    const identity = card.element.querySelector('.seventv-user-card-identity');
    if (identity) return { el: identity, how: 'append' };
    return { el: card.element, how: 'append' };
  }

  const viewerCard = card.element.querySelector('.viewer-card');
  if (viewerCard) {
    const headerBg = viewerCard.querySelector('.viewer-card-header__background');
    const afterHeader = headerBg?.nextElementSibling ?? null;
    if (afterHeader) return { el: afterHeader, how: 'insertBefore' };
    return { el: viewerCard, how: 'append' };
  }

  const inner =
    card.element.querySelector('[data-a-target="viewer-card-body"]') ??
    card.element.querySelector('.viewer-card__card-area') ??
    card.element.children[0];

  if (inner) return { el: inner, how: 'append' };
  return null;
}

// ── Main badge injection ──────────────────────────────────────────────────────

export async function injectBadge(
  card: DetectedCard,
  rating: RatingData | null,
  channelLogin: string,
): Promise<void> {
  ensureBadgeStyle();
  card.element.querySelector(`[${BADGE_ATTR}]`)?.remove();

  const score = rating?.score ?? 0;
  const isLow = rating?.isLowRating ?? score < 0;
  const accent = scoreAccent(score);

  // Root wrapper
  const wrap = document.createElement('div');
  wrap.setAttribute(BADGE_ATTR, card.login);
  if (channelLogin) wrap.setAttribute(CHANNEL_ATTR, channelLogin);

  // Left accent stripe
  const stripe = document.createElement('div');
  stripe.className = 'tsr-stripe';
  stripe.style.cssText = `background:${accent};box-shadow:4px 0 16px 4px ${accent}30,2px 0 6px 2px ${accent}50;`;
  wrap.appendChild(stripe);

  // Row 1: label (left) + profile link (right)
  const topRow = document.createElement('div');
  topRow.className = 'tsr-row';

  const label = document.createElement('span');
  label.setAttribute(LABEL_ATTR, '');
  setLabel(label, channelLogin, isLow);
  topRow.appendChild(label);

  if (channelLogin) {
    const link = document.createElement('a');
    link.className = 'tsr-link';
    link.href = `${__FRONTEND_URL__}/profile/${encodeURIComponent(card.login)}?channel=${encodeURIComponent(channelLogin)}`;
    link.target = '_blank';
    link.rel = 'noopener noreferrer';
    link.textContent = 'Профиль →';
    link.addEventListener('click', (e) => e.stopPropagation());
    topRow.appendChild(link);
  }

  wrap.appendChild(topRow);

  // Row 2: score (left) + vote buttons (right)
  const bottomRow = document.createElement('div');
  bottomRow.className = 'tsr-row';

  const scoreEl = document.createElement('span');
  scoreEl.setAttribute(SCORE_ATTR, '');
  scoreEl.style.color = scoreFg(score);
  scoreEl.textContent = scoreText(score);
  bottomRow.appendChild(scoreEl);

  const auth = (await browser.runtime
    .sendMessage({ type: 'GET_AUTH' })
    .catch(() => ({ authenticated: false, userLogin: null }))) as {
    authenticated: boolean;
    userLogin: string | null;
  };

  const isSelf = auth.userLogin != null && auth.userLogin === card.login;

  if (auth.authenticated && !isSelf) {
    const plusBtn = makeVoteBtn(PLUS_ONE_SVG, '#0FEE9F');
    plusBtn.style.border = 'none';
    plusBtn.style.color = '';
    const minusBtn = makeVoteBtn(MINUS_ONE_SVG, '#EC5B5B');
    minusBtn.style.border = 'none';
    minusBtn.style.color = '';

    const handleVote = async (value: 1 | -1) => {
      const activeBtn = value === 1 ? plusBtn : minusBtn;
      const otherBtn = value === 1 ? minusBtn : plusBtn;
      const original = activeBtn.innerHTML;

      plusBtn.disabled = true;
      minusBtn.disabled = true;
      activeBtn.innerHTML = '…';
      otherBtn.style.opacity = '0.35';

      const res = (await browser.runtime
        .sendMessage({ type: 'CAST_VOTE', login: card.login, channelLogin, value })
        .catch(() => ({ ok: false, error: 'network_error' }))) as {
        ok: boolean;
        score?: number;
        error?: string;
        nextVoteAt?: number;
      };

      plusBtn.disabled = false;
      minusBtn.disabled = false;
      activeBtn.innerHTML = original;
      otherBtn.style.opacity = '1';

      if (res.ok && res.score !== undefined) {
        const ns = res.score;
        const newAccent = scoreAccent(ns);
        stripe.style.background = newAccent;
        stripe.style.boxShadow = `4px 0 16px 4px ${newAccent}30,2px 0 6px 2px ${newAccent}50`;
        scoreEl.style.color = scoreFg(ns);
        scoreEl.textContent = scoreText(ns);
        setLabel(label, channelLogin, ns < 0);
        const nextTs = res.nextVoteAt ? res.nextVoteAt * 1000 : Date.now() + 86400000;
        showToast(wrap, `Голос принят. Новый рейтинг ${scoreText(ns)}. Следующее голосование ${formatNextVoteDate(nextTs)}`, 'ok');
      } else {
        const msg = formatVoteError(res.error ?? '', res.nextVoteAt);
        showToast(wrap, msg, msg.startsWith('Подожди') ? 'warn' : 'err');
      }
    };

    plusBtn.addEventListener('click', (e) => { e.stopPropagation(); e.preventDefault(); handleVote(1); });
    minusBtn.addEventListener('click', (e) => { e.stopPropagation(); e.preventDefault(); handleVote(-1); });

    bottomRow.appendChild(plusBtn);
    bottomRow.appendChild(minusBtn);

    const permissions = await getChannelPermissions(channelLogin);

    // ── Pencil: inline rating adjustment ──────────────────────────────
    if (permissions?.can_adjust_rating) {
      const pencilBtn = document.createElement('button');
      pencilBtn.className = 'tsr-vote-btn';
      pencilBtn.innerHTML = PENCIL_SVG;
      pencilBtn.title = 'Изменить рейтинг';
      pencilBtn.style.cssText = 'width:24px;height:24px;padding:0;border:none;background:transparent;display:flex;align-items:center;justify-content:center;cursor:pointer;';
      scoreEl.insertAdjacentElement('afterend', pencilBtn);

      const editRow = document.createElement('div');
      editRow.className = 'tsr-row';
      editRow.style.display = 'none';

      const input = document.createElement('input');
      input.type = 'text';
      input.inputMode = 'numeric';
      input.placeholder = '±число';
      input.style.cssText = 'width:80px;font-size:12px;background:#18181b;border:1px solid #1f1f23;color:#efeff1;border-radius:4px;padding:3px 6px;outline:none;font-family:ui-monospace,monospace;';

      const confirmBtn = makeIconBtn('✓', '#00e676');
      confirmBtn.title = 'Применить';
      const cancelBtn = makeIconBtn('✕', '#adadb8');
      cancelBtn.title = 'Отмена';

      const doApply = async () => {
        const raw = input.value.trim().replace(/−/g, '-');
        if (!/^[+-]?\d+$/.test(raw)) {
          showToast(wrap, 'Некорректное значение', 'err');
          return;
        }
        const parsed = Number(raw);
        if (!Number.isSafeInteger(parsed) || parsed < -1000 || parsed > 1000) {
          showToast(wrap, 'Значение от −1000 до +1000', 'err');
          return;
        }
        const mode: 'delta' | 'set' = /^[+-]/.test(raw) ? 'delta' : 'set';
        confirmBtn.disabled = true;
        cancelBtn.disabled = true;

        const res = (await browser.runtime
          .sendMessage({ type: 'ADJUST_CHANNEL_RATING', login: card.login, channelLogin, value: parsed, mode })
          .catch(() => ({ ok: false, error: 'network_error' }))) as {
          ok: boolean;
          score?: number;
          error?: string;
        };

        confirmBtn.disabled = false;
        cancelBtn.disabled = false;

        if (res.ok && res.score !== undefined) {
          const ns = res.score;
          const newAccent = scoreAccent(ns);
          stripe.style.background = newAccent;
          stripe.style.boxShadow = `4px 0 16px 4px ${newAccent}30,2px 0 6px 2px ${newAccent}50`;
          scoreEl.style.color = scoreFg(ns);
          scoreEl.textContent = scoreText(ns);
          setLabel(label, channelLogin, ns < 0);
          showToast(wrap, `Рейтинг обновлён: ${scoreText(ns)}`, 'ok');
          editRow.style.display = 'none';
          pencilBtn.style.display = '';
          input.value = '';
        } else {
          showToast(wrap, res.error === 'not_authenticated' ? 'Не авторизован' : 'Ошибка изменения рейтинга', 'err');
        }
      };

      const doCancel = () => {
        editRow.style.display = 'none';
        pencilBtn.style.display = '';
        input.value = '';
      };

      confirmBtn.addEventListener('click', (e) => { e.stopPropagation(); e.preventDefault(); doApply(); });
      cancelBtn.addEventListener('click', (e) => { e.stopPropagation(); e.preventDefault(); doCancel(); });
      input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') { e.stopPropagation(); doApply(); }
        if (e.key === 'Escape') { e.stopPropagation(); doCancel(); }
      });

      editRow.appendChild(input);
      editRow.appendChild(confirmBtn);
      editRow.appendChild(cancelBtn);
      wrap.appendChild(editRow);

      pencilBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        e.preventDefault();
        pencilBtn.style.display = 'none';
        editRow.style.display = 'flex';
        input.focus();
      });
    }

    // ── Sword: moderator toggle ───────────────────────────────────────
    if (permissions?.can_manage_moderators) {
      const moderators = await getChannelModerators(channelLogin);
      const isModerator = moderators?.some(
        (m) => m.login.toLowerCase() === card.login.toLowerCase() && m.role === 'moderator',
      ) ?? false;

      let currentIsModerator = isModerator;

      const swordBtn = document.createElement('button');
      swordBtn.className = 'tsr-vote-btn';
      swordBtn.title = currentIsModerator ? 'Снять модератора' : 'Назначить модератором';
      swordBtn.style.cssText = 'width:24px;height:24px;padding:0;border:none;border-radius:4px;display:flex;align-items:center;justify-content:center;cursor:pointer;overflow:hidden;flex-shrink:0;';

      const applySwordStyle = () => {
        const strokeColor = currentIsModerator ? '#EC5B5B' : '#0FEE9F';
        swordBtn.style.background = 'transparent';
        swordBtn.innerHTML = swordSvg(strokeColor);
        swordBtn.title = currentIsModerator ? 'Снять модератора' : 'Назначить модератором';
      };

      swordBtn.addEventListener('mouseover', () => {
        if (swordBtn.disabled) return;
        swordBtn.style.filter = 'brightness(1.15)';
      });
      swordBtn.addEventListener('mouseout', () => {
        if (swordBtn.disabled) return;
        swordBtn.style.filter = 'none';
      });

      swordBtn.addEventListener('click', async (e) => {
        e.stopPropagation();
        e.preventDefault();
        swordBtn.disabled = true;
        const action = currentIsModerator
          ? { type: 'REMOVE_CHANNEL_MODERATOR', channelLogin, targetLogin: card.login }
          : { type: 'ADD_CHANNEL_MODERATOR', channelLogin, targetLogin: card.login };
        const res = (await browser.runtime.sendMessage(action).catch(() => ({ ok: false, error: 'network_error' }))) as {
          ok: boolean;
          error?: string;
        };
        swordBtn.disabled = false;
        if (res.ok) {
          currentIsModerator = !currentIsModerator;
          applySwordStyle();
          showToast(wrap, currentIsModerator ? 'Модератор назначен' : 'Модератор снят', 'ok');
        } else {
          showToast(wrap, res.error ?? 'Ошибка', 'err');
        }
      });

      applySwordStyle();
      bottomRow.appendChild(swordBtn);
    }
  }

  wrap.appendChild(bottomRow);

  // Inject
  const target = findTarget(card);
  if (!target) return;

  if (target.gridArea) wrap.style.gridArea = target.gridArea;

  wrap.style.opacity = '0';
  wrap.style.transition = 'opacity 0.2s ease';

  if (target.how === 'insertAfter') {
    target.el.insertAdjacentElement('afterend', wrap);
  } else if (target.how === 'insertBefore') {
    target.el.insertAdjacentElement('beforebegin', wrap);
  } else {
    target.el.appendChild(wrap);
  }

  requestAnimationFrame(() => { wrap.style.opacity = '1'; });
}

// ── Live update from WebSocket ────────────────────────────────────────────────

export function updateBadgeScore(login: string, score: number): void {
  const wrap = document.querySelector<HTMLElement>(`[${BADGE_ATTR}="${CSS.escape(login)}"]`);
  if (!wrap) return;

  const stripe = wrap.querySelector<HTMLElement>('.tsr-stripe');
  if (stripe) {
    const accent = scoreAccent(score);
    stripe.style.background = accent;
    stripe.style.boxShadow = `4px 0 16px 4px ${accent}30,2px 0 6px 2px ${accent}50`;
  }

  const scoreEl = wrap.querySelector<HTMLElement>(`[${SCORE_ATTR}]`);
  if (scoreEl) {
    scoreEl.style.color = scoreFg(score);
    scoreEl.textContent = scoreText(score);
  }

  const labelEl = wrap.querySelector<HTMLElement>(`[${LABEL_ATTR}]`);
  if (labelEl) {
    setLabel(labelEl, wrap.getAttribute(CHANNEL_ATTR) ?? '', score < 0);
  }
}
