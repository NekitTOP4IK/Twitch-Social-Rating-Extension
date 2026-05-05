import browser from 'webextension-polyfill';
import { DetectedCard } from './card-detector';
import { RatingData } from '../types';

const BADGE_ATTR = 'data-tsr-badge';
const SCORE_ATTR = 'data-tsr-score';
const LABEL_ATTR = 'data-tsr-label';
const CHANNEL_ATTR = 'data-tsr-channel';

// ── Color helpers ─────────────────────────────────────────────────────────────

function scoreFg(score: number): string {
  if (score > 0) return '#00c853';
  if (score < 0) return '#ff4444';
  return '#adadb8';
}

function scoreBorderColor(score: number): string {
  if (score > 0) return '#00c853';
  if (score < 0) return '#ff4444';
  return '#3a3a3d';
}

function scoreText(score: number): string {
  if (score > 0) return `+${score}`;
  if (score < 0) return `${score}`;
  return '0';
}

function formatVoteError(error: string): string {
  if (error.includes('24 hours') || error === '429') return 'Подожди — голосовать можно раз в 24 часа';
  if (error.includes('yourself')) return 'Нельзя голосовать за себя';
  if (error.includes('below zero')) return 'Твой рейтинг < 0 — голосование заблокировано';
  if (error === 'not_authenticated') return 'Не авторизован. Войди через иконку расширения.';
  if (error === 'network_error') return 'Ошибка сети';
  return error.length < 80 ? error : 'Ошибка голосования';
}

// ── Toast (auto-hides after 3.5s) ────────────────────────────────────────────

function showToast(container: HTMLElement, text: string, type: 'ok' | 'warn' | 'err'): void {
  container.querySelector('[data-tsr-toast]')?.remove();
  const el = document.createElement('div');
  el.setAttribute('data-tsr-toast', '');
  const color = type === 'ok' ? '#00c853' : type === 'warn' ? '#ffb300' : '#ff4444';
  el.style.cssText = `color:${color};font-size:11px;font-weight:600;padding:3px 0 1px;line-height:1.4;word-break:break-word;`;
  el.textContent = text;
  container.appendChild(el);
  const t = setTimeout(() => el.remove(), 3500);
  el.addEventListener('click', () => { clearTimeout(t); el.remove(); });
}

// ── Vote button factory ───────────────────────────────────────────────────────

function makeVoteBtn(label: string): HTMLButtonElement {
  const btn = document.createElement('button');
  btn.textContent = label;
  btn.style.cssText = [
    'border:1px solid #3a3a3d',
    'background:#1f1f23',
    'color:#efeff1',
    'border-radius:4px',
    'padding:2px 9px',
    'cursor:pointer',
    'font-size:12px',
    'font-weight:700',
    'line-height:18px',
    'flex-shrink:0',
    'user-select:none',
  ].join(';');
  btn.addEventListener('mouseover', () => { if (!btn.disabled) btn.style.background = '#2a2a2d'; });
  btn.addEventListener('mouseout', () => { if (!btn.disabled) btn.style.background = '#1f1f23'; });
  return btn;
}

// ── 7tv CSS fix (injected once) ───────────────────────────────────────────────

function ensureSeventvStyle(): void {
  if (document.getElementById('tsr-seventv-style')) return;
  const style = document.createElement('style');
  style.id = 'tsr-seventv-style';
  // Without explicit height, the card's 1fr data row doesn't shrink when the
  // header grows — causing the message list to overflow the card boundary.
  // Adding height: 48rem makes the grid deterministic so 1fr works correctly.
  style.textContent = `
    /* Fix 1: cap card height at 80vh so it doesn't grow endlessly,
       but still lets it stay compact when the timeline is short. */
    .seventv-user-card-container:has([data-tsr-badge]) .seventv-user-card {
      max-height: 80vh !important;
      overflow: hidden !important;
    }

    /* Fix 2: data area must be able to shrink — flex/grid min-height defaults
       to auto, which prevents the row from collapsing when the header grows. */
    .seventv-user-card-container:has([data-tsr-badge]) .seventv-user-card-data {
      min-height: 0 !important;
      overflow: hidden !important;
    }

    /* Fix 3: the scrollable timeline container needs min-height: 0 and
       explicit overflow-y so it scrolls instead of expanding the card. */
    .seventv-user-card-container:has([data-tsr-badge]) .seventv-user-card-data .scrollable-container {
      min-height: 0 !important;
      overflow-y: auto !important;
    }

    /* Fix 4: add our badge as a named grid area between actions and mod */
    .seventv-user-card-container:has([data-tsr-badge]) .seventv-user-card-interactive {
      grid-template-rows: auto auto auto auto !important;
      grid-template-areas: "metrics" "actions" "tsr-rating" "mod" !important;
    }
  `;
  document.head.appendChild(style);
}

// ── Find safe injection target inside the card ────────────────────────────────

function findTarget(card: DetectedCard): { el: Element; how: 'append' | 'insertAfter' | 'insertBefore'; gridArea?: string } | null {
  if (card.type === 'seventv') {
    ensureSeventvStyle();
    const interactive = card.element.querySelector('.seventv-user-card-interactive');
    if (interactive) return { el: interactive, how: 'append', gridArea: 'tsr-rating' };
    const identity = card.element.querySelector('.seventv-user-card-identity');
    if (identity) return { el: identity, how: 'append' };
    return { el: card.element, how: 'append' };
  }

  // Native Twitch: inject inside .viewer-card, between header and badges section
  const viewerCard = card.element.querySelector('.viewer-card');
  if (viewerCard) {
    const headerBg = viewerCard.querySelector('.viewer-card-header__background');
    const afterHeader = headerBg?.nextElementSibling ?? null;
    if (afterHeader) return { el: afterHeader, how: 'insertBefore' };
    return { el: viewerCard, how: 'append' };
  }

  // Fallback
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
  card.element.querySelector(`[${BADGE_ATTR}]`)?.remove();

  const score = rating?.score ?? 0;
  const isLow = rating?.isLowRating ?? score < 0;
  const fg = scoreFg(score);
  const borderColor = scoreBorderColor(score);

  // Root wrapper — no margin, border-top acts as visual separator from card content
  const wrap = document.createElement('div');
  wrap.setAttribute(BADGE_ATTR, card.login);
  if (channelLogin) wrap.setAttribute(CHANNEL_ATTR, channelLogin);
  wrap.style.cssText = [
    'box-sizing:border-box',
    'display:flex',
    'flex-direction:column',
    'grid-column:1 / -1',
    'gap:4px',
    'padding:8px 10px',
    'background:#0e0e10',
    'border-top:1px solid #2a2a2d',
    `border-left:3px solid ${borderColor}`,
    'flex-shrink:0',
    'overflow:hidden',
    'width:100%',
  ].join(';');

  const labelPrefix = channelLogin ? `${channelLogin} / ` : '';

  // Label
  const label = document.createElement('span');
  label.setAttribute(LABEL_ATTR, '');
  label.style.cssText = `font-size:10px;font-weight:600;letter-spacing:0.07em;text-transform:uppercase;color:${isLow ? '#ff4444' : '#adadb8'};line-height:1;`;
  label.textContent = isLow ? `⚠ ${labelPrefix}НИЗКИЙ РЕЙТИНГ` : `${labelPrefix}СОЦИАЛЬНЫЙ РЕЙТИНГ`;
  wrap.appendChild(label);

  // Score + buttons row
  const row = document.createElement('div');
  row.style.cssText = 'display:flex;align-items:center;gap:5px;';

  const scoreEl = document.createElement('span');
  scoreEl.setAttribute(SCORE_ATTR, '');
  scoreEl.style.cssText = `font-size:17px;font-weight:700;font-family:monospace;color:${fg};flex:1;line-height:1;`;
  scoreEl.textContent = scoreText(score);
  row.appendChild(scoreEl);

  // Auth state → vote buttons
  const auth = (await browser.runtime
    .sendMessage({ type: 'GET_AUTH' })
    .catch(() => ({ authenticated: false, userLogin: null }))) as {
    authenticated: boolean;
    userLogin: string | null;
  };

  const isSelf = auth.userLogin != null && auth.userLogin === card.login;

  if (auth.authenticated && !isSelf) {
    const plusBtn = makeVoteBtn('+1');
    const minusBtn = makeVoteBtn('−1');

    const handleVote = async (value: 1 | -1) => {
      const activeBtn = value === 1 ? plusBtn : minusBtn;
      const otherBtn = value === 1 ? minusBtn : plusBtn;
      const originalText = activeBtn.textContent ?? '';

      plusBtn.disabled = true;
      minusBtn.disabled = true;
      activeBtn.textContent = '…';
      otherBtn.style.opacity = '0.45';

      const res = (await browser.runtime
        .sendMessage({ type: 'CAST_VOTE', login: card.login, channelLogin, value })
        .catch(() => ({ ok: false, error: 'network_error' }))) as {
        ok: boolean;
        score?: number;
        error?: string;
      };

      plusBtn.disabled = false;
      minusBtn.disabled = false;
      activeBtn.textContent = originalText;
      otherBtn.style.opacity = '1';

      if (res.ok && res.score !== undefined) {
        const ns = res.score;
        wrap.style.borderLeftColor = scoreBorderColor(ns);
        scoreEl.style.color = scoreFg(ns);
        scoreEl.textContent = scoreText(ns);
        const low = ns < 0;
        label.style.color = low ? '#ff4444' : '#adadb8';
        label.textContent = low ? '⚠ НИЗКИЙ РЕЙТИНГ' : 'СОЦИАЛЬНЫЙ РЕЙТИНГ';
        showToast(wrap, `✓ Оценка принята — рейтинг ${scoreText(ns)}`, 'ok');
      } else {
        const msg = formatVoteError(res.error ?? '');
        showToast(wrap, msg, msg.startsWith('Подожди') ? 'warn' : 'err');
      }
    };

    plusBtn.addEventListener('click', (e) => { e.stopPropagation(); e.preventDefault(); handleVote(1); });
    minusBtn.addEventListener('click', (e) => { e.stopPropagation(); e.preventDefault(); handleVote(-1); });

    row.appendChild(plusBtn);
    row.appendChild(minusBtn);
  }

  wrap.appendChild(row);

  // Inject without breaking card layout
  const target = findTarget(card);
  if (!target) return;

  if (target.gridArea) wrap.style.gridArea = target.gridArea;

  wrap.style.opacity = '0';
  wrap.style.transition = 'opacity 0.25s ease';

  if (target.how === 'insertAfter') {
    target.el.insertAdjacentElement('afterend', wrap);
  } else if (target.how === 'insertBefore') {
    target.el.insertAdjacentElement('beforebegin', wrap);
  } else {
    target.el.appendChild(wrap);
  }

  requestAnimationFrame(() => {
    wrap.style.opacity = '1';

  });
}

// ── Live update from WebSocket ────────────────────────────────────────────────

export function updateBadgeScore(login: string, score: number): void {
  const wrap = document.querySelector<HTMLElement>(`[${BADGE_ATTR}="${CSS.escape(login)}"]`);
  if (!wrap) return;

  wrap.style.borderLeftColor = scoreBorderColor(score);

  const scoreEl = wrap.querySelector<HTMLElement>(`[${SCORE_ATTR}]`);
  if (scoreEl) {
    scoreEl.style.color = scoreFg(score);
    scoreEl.textContent = scoreText(score);
  }

  const labelEl = wrap.querySelector<HTMLElement>(`[${LABEL_ATTR}]`);
  if (labelEl) {
    const low = score < 0;
    const channel = wrap.getAttribute(CHANNEL_ATTR) ?? '';
    const prefix = channel ? `${channel} / ` : '';
    labelEl.style.color = low ? '#ff4444' : '#adadb8';
    labelEl.textContent = low ? `⚠ ${prefix}НИЗКИЙ РЕЙТИНГ` : `${prefix}СОЦИАЛЬНЫЙ РЕЙТИНГ`;
  }
}
