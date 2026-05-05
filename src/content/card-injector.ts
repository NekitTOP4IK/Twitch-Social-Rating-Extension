import browser from 'webextension-polyfill';
import { DetectedCard } from './card-detector';
import { RatingData } from '../types';

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
      border-radius: 12px;
      height: 24px;
      padding: 0 10px;
      font-size: 12px;
      font-weight: 700;
      cursor: pointer;
      user-select: none;
      line-height: 22px;
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

function formatVoteError(error: string): string {
  if (error.includes('24 hours') || error === '429') return 'Подожди — голосовать можно раз в 24 часа';
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
  btn.textContent = label;
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
    const plusBtn = makeVoteBtn('+1', '#00e676');
    const minusBtn = makeVoteBtn('−1', '#ff5252');

    const handleVote = async (value: 1 | -1) => {
      const activeBtn = value === 1 ? plusBtn : minusBtn;
      const otherBtn = value === 1 ? minusBtn : plusBtn;
      const original = activeBtn.textContent ?? '';

      plusBtn.disabled = true;
      minusBtn.disabled = true;
      activeBtn.textContent = '…';
      otherBtn.style.opacity = '0.35';

      const res = (await browser.runtime
        .sendMessage({ type: 'CAST_VOTE', login: card.login, channelLogin, value })
        .catch(() => ({ ok: false, error: 'network_error' }))) as {
        ok: boolean;
        score?: number;
        error?: string;
      };

      plusBtn.disabled = false;
      minusBtn.disabled = false;
      activeBtn.textContent = original;
      otherBtn.style.opacity = '1';

      if (res.ok && res.score !== undefined) {
        const ns = res.score;
        const newAccent = scoreAccent(ns);
        stripe.style.background = newAccent;
        stripe.style.boxShadow = `4px 0 16px 4px ${newAccent}30,2px 0 6px 2px ${newAccent}50`;
        scoreEl.style.color = scoreFg(ns);
        scoreEl.textContent = scoreText(ns);
        setLabel(label, channelLogin, ns < 0);
        showToast(wrap, `Принято — рейтинг ${scoreText(ns)}`, 'ok');
      } else {
        const msg = formatVoteError(res.error ?? '');
        showToast(wrap, msg, msg.startsWith('Подожди') ? 'warn' : 'err');
      }
    };

    plusBtn.addEventListener('click', (e) => { e.stopPropagation(); e.preventDefault(); handleVote(1); });
    minusBtn.addEventListener('click', (e) => { e.stopPropagation(); e.preventDefault(); handleVote(-1); });

    bottomRow.appendChild(plusBtn);
    bottomRow.appendChild(minusBtn);
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
