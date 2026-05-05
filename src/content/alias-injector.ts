import { getAlias, isAliased } from './alias-manager';
import { detectCardLogin } from './card-detector';

const ALIASED_ATTR = 'data-tsr-aliased';
const ORIGINAL_ATTR = 'data-tsr-original';

// ── Core rewrite helpers ─────────────────────────────────────────────────────

function getTextNode(element: Element): Text | null {
  // Walk down through single meaningful children (skip comment/empty text nodes)
  let current: Node = element;
  while (true) {
    const meaningful = Array.from(current.childNodes).filter(
      (n) =>
        n.nodeType !== Node.COMMENT_NODE &&
        !(n.nodeType === Node.TEXT_NODE && !n.textContent?.trim()),
    );
    if (meaningful.length === 1 && meaningful[0].nodeType === Node.ELEMENT_NODE) {
      current = meaningful[0];
    } else {
      break;
    }
  }

  if (current.childNodes.length === 1 && current.firstChild?.nodeType === Node.TEXT_NODE) {
    return current.firstChild as Text;
  }
  for (const node of current.childNodes) {
    if (node.nodeType === Node.TEXT_NODE) return node as Text;
  }
  return null;
}

function rewriteText(element: Element, login: string): void {
  const alias = getAlias(login);
  if (!alias) {
    restoreElement(element);
    return;
  }

  const textNode = getTextNode(element);
  if (!textNode) return;

  const original = element.getAttribute(ORIGINAL_ATTR) ?? textNode.textContent ?? '';
  if (original && !element.hasAttribute(ORIGINAL_ATTR)) {
    element.setAttribute(ORIGINAL_ATTR, original);
  }

  if (textNode.textContent !== alias) {
    textNode.textContent = alias;
  }
  element.setAttribute(ALIASED_ATTR, 'true');
  element.setAttribute('title', login); // browser-native tooltip with original login
}

function restoreElement(element: Element): void {
  if (!element.hasAttribute(ALIASED_ATTR)) return;
  const original = element.getAttribute(ORIGINAL_ATTR);
  if (original !== null) {
    const textNode = getTextNode(element);
    if (textNode) textNode.textContent = original;
  }
  element.removeAttribute(ALIASED_ATTR);
  element.removeAttribute(ORIGINAL_ATTR);
  element.removeAttribute('title');
}

function getLoginFromMessage(line: Element): string | null {
  const msg = line.closest('.chat-line__message');
  if (msg) {
    const login = msg.getAttribute('data-a-user');
    if (login) return login.toLowerCase();
  }
  const selfLogin = line.getAttribute('data-a-user');
  if (selfLogin) return selfLogin.toLowerCase();

  // 7TV timeline messages inside a user card have no .chat-line__message wrapper
  const card = line.closest('.seventv-user-card');
  if (card) {
    const detected = detectCardLogin(card);
    if (detected) return detected.login;
  }
  return null;
}

// ── Chat rewriting ─────────────────────────────────────────────────────────

export function applyAliasesToChatLine(line: Element): void {
  const login = getLoginFromMessage(line);
  if (!login) return;

  const displayName = line.querySelector('.chat-author__display-name');
  if (displayName) rewriteText(displayName, login);

  const seventvName = line.querySelector('.seventv-chat-user-username');
  if (seventvName) rewriteText(seventvName, login);

  const msgWrapper = line.closest('.chat-line__message');
  if (msgWrapper) {
    const label = msgWrapper.getAttribute('aria-label');
    if (label) {
      const alias = getAlias(login);
      if (alias) {
        const regex = new RegExp(`\\b${escapeRegex(login)}\\b`, 'gi');
        const newLabel = label.replace(regex, alias);
        if (newLabel !== label) msgWrapper.setAttribute('aria-label', newLabel);
      }
    }
  }

  const replyBtn = line.querySelector('button[aria-label*="reply"]');
  if (replyBtn) {
    const rLabel = replyBtn.getAttribute('aria-label');
    if (rLabel) {
      const alias = getAlias(login);
      if (alias) {
        const regex = new RegExp(`@${escapeRegex(login)}\\b`, 'gi');
        const newLabel = rLabel.replace(regex, `@${alias}`);
        if (newLabel !== rLabel) replyBtn.setAttribute('aria-label', newLabel);
      }
    }
  }

  const mentions = line.querySelectorAll('.mention-fragment, [data-a-target="chat-message-mention"]');
  for (const mention of mentions) {
    const textNode = getTextNode(mention);
    if (!textNode) continue;
    const text = textNode.textContent ?? '';
    const m = text.match(/^@([a-zA-Z0-9_]+)$/);
    if (!m) continue;
    const mentionLogin = m[1].toLowerCase();
    const alias = getAlias(mentionLogin);
    if (alias) {
      const original = mention.getAttribute(ORIGINAL_ATTR) ?? text;
      if (!mention.hasAttribute(ORIGINAL_ATTR)) mention.setAttribute(ORIGINAL_ATTR, original);
      textNode.textContent = `@${alias}`;
      mention.setAttribute(ALIASED_ATTR, 'true');
      mention.setAttribute('title', `@${mentionLogin}`);
    }
  }
}

export function applyAliasesToAllChat(): void {
  const nativeLines = document.querySelectorAll('.chat-line__message');
  for (const line of nativeLines) applyAliasesToChatLine(line);

  const seventvMessages = document.querySelectorAll('.seventv-user-message');
  for (const msg of seventvMessages) {
    const wrapper = msg.closest('.chat-line__message');
    if (wrapper) {
      applyAliasesToChatLine(wrapper);
    } else {
      const card = msg.closest('.seventv-user-card');
      if (card) {
        // Timeline message inside a 7TV user card — derive login from the card header
        const detected = detectCardLogin(card);
        if (detected) {
          const nameEl = msg.querySelector('.seventv-chat-user-username');
          if (nameEl) rewriteText(nameEl, detected.login);
        }
      } else {
        // Other standalone 7TV message (not in a card) — best-effort
        const userBlock = msg.querySelector('.seventv-chat-user');
        if (userBlock) {
          const nameEl = userBlock.querySelector('.seventv-chat-user-username');
          if (nameEl) {
            const login = userBlock.getAttribute('data-a-user') ?? nameEl.textContent?.toLowerCase() ?? '';
            if (login) rewriteText(nameEl, login);
          }
        }
      }
    }
  }
}

// ── Viewer card rewriting ───────────────────────────────────────────────────

export function applyAliasesToViewerCard(cardEl: Element, login: string): void {
  const alias = getAlias(login);
  if (!alias) return;

  const nativeLink = cardEl.querySelector('.viewer-card-header__display-name a.tw-link');
  if (nativeLink) rewriteText(nativeLink, login);

  const seventvLink = cardEl.querySelector('.seventv-user-card-usertag');
  if (seventvLink) {
    const nameEl = seventvLink.querySelector('.seventv-chat-user-username');
    if (nameEl) rewriteText(nameEl, login);
  }

  // 7TV card timeline messages (message history inside the card)
  const timelineList = cardEl.querySelector('.seventv-user-card-message-timeline-list');
  if (timelineList) {
    timelineList.querySelectorAll('.seventv-chat-user-username').forEach((el) => {
      rewriteText(el, login);
    });
  }

  const followBtn = cardEl.querySelector('button[data-a-target="follow-button"]');
  if (followBtn) {
    const label = followBtn.getAttribute('aria-label');
    if (label) {
      const regex = new RegExp(`\\b${escapeRegex(login)}\\b`, 'gi');
      const newLabel = label.replace(regex, alias);
      if (newLabel !== label) followBtn.setAttribute('aria-label', newLabel);
    }
  }
}

// ── Leaderboard rewriting ──────────────────────────────────────────────────

export function applyAliasesToLeaderboard(): void {
  const selectors = [
    '[data-test-selector="leaderboard-item-name-test-selector"]',
    '[class*="channelLeaderboardHeaderRunnerUpEntry__username"]',
  ];

  for (const sel of selectors) {
    const items = document.querySelectorAll(sel);
    for (const item of items) {
      const strong = item.querySelector('strong[title]');
      if (!strong) continue;
      const login = strong.getAttribute('title')?.toLowerCase() ?? '';
      if (!login) continue;
      const alias = getAlias(login);
      if (!alias) {
        restoreElement(strong);
        continue;
      }
      const textNode = getTextNode(strong);
      if (!textNode) continue;
      const original = strong.getAttribute(ORIGINAL_ATTR) ?? textNode.textContent ?? '';
      if (!strong.hasAttribute(ORIGINAL_ATTR)) strong.setAttribute(ORIGINAL_ATTR, original);
      textNode.textContent = alias;
      strong.setAttribute(ALIASED_ATTR, 'true');
      strong.setAttribute('title', login);
    }
  }
}

// ── Side-nav rewriting ─────────────────────────────────────────────────────

export function applyAliasesToSideNav(): void {
  const cards = document.querySelectorAll('.side-nav-card');
  for (const card of cards) {
    const img = card.querySelector<HTMLImageElement>('.side-nav-card__avatar img');
    if (!img || !img.alt) continue;
    const login = img.alt.toLowerCase();
    const alias = getAlias(login);
    if (alias) {
      const original = img.getAttribute(ORIGINAL_ATTR) ?? img.alt;
      if (!img.hasAttribute(ORIGINAL_ATTR)) img.setAttribute(ORIGINAL_ATTR, original);
      img.alt = alias;
      img.setAttribute(ALIASED_ATTR, 'true');
      img.setAttribute('title', login);
    } else {
      const original = img.getAttribute(ORIGINAL_ATTR);
      if (original !== null) {
        img.alt = original;
        img.removeAttribute(ALIASED_ATTR);
        img.removeAttribute(ORIGINAL_ATTR);
        img.removeAttribute('title');
      }
    }
  }
}

// ── Batch re-apply ───────────────────────────────────────────────────────────

let batchTimer: ReturnType<typeof setTimeout> | null = null;

export function scheduleBatchReapply(): void {
  if (batchTimer) clearTimeout(batchTimer);
  batchTimer = setTimeout(() => {
    applyAliasesToAllChat();
    applyAliasesToLeaderboard();
    applyAliasesToSideNav();
  }, 50);
}

// ── Pencil / reset UI helpers for cards ────────────────────────────────────

const EDIT_ICON_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>`;
const RESET_ICON_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/><path d="M3 3v5h5"/></svg>`;

function makeIconBtn(svg: string, color: string, hoverColor: string, title: string): HTMLButtonElement {
  const btn = document.createElement('button');
  btn.innerHTML = svg;
  btn.title = title;
  btn.style.cssText = `
    display:inline-flex;align-items:center;justify-content:center;
    width:18px;height:18px;padding:0;margin-left:4px;
    border:none;background:transparent;cursor:pointer;
    color:${color};flex-shrink:0;vertical-align:middle;
  `;
  btn.addEventListener('mouseover', () => { btn.style.color = hoverColor; });
  btn.addEventListener('mouseout', () => { btn.style.color = color; });
  return btn;
}

export function injectCardAliasControls(
  cardEl: Element,
  login: string,
  onSetAlias: (login: string, alias: string) => void,
  onRemoveAlias: (login: string) => void,
): void {
  if (cardEl.querySelector('[data-tsr-alias-controls]')) return;

  const alias = getAlias(login);
  const isCurrentlyAliased = !!alias;

  let nameEl: Element | null = null;
  let btnContainer: Element | null = null;

  const nativeDisplay = cardEl.querySelector('.viewer-card-header__display-name');
  if (nativeDisplay) {
    nameEl = nativeDisplay.querySelector('a.tw-link, h4 a');
    if (nameEl) btnContainer = nameEl.parentElement;
  }

  const seventvTag = cardEl.querySelector('.seventv-user-card-usertag');
  if (seventvTag) {
    const chatUser = seventvTag.querySelector('.seventv-chat-user');
    if (chatUser) {
      nameEl = chatUser.querySelector('.seventv-chat-user-username');
      if (nameEl) btnContainer = chatUser;
    }
  }

  if (!nameEl || !btnContainer) return;

  const btnWrap = document.createElement('span');
  btnWrap.setAttribute('data-tsr-alias-controls', '');
  btnWrap.style.cssText = 'display:inline-flex;align-items:center;vertical-align:middle;margin-left:4px;';

  const editBtn = makeIconBtn(EDIT_ICON_SVG, '#adadb8', '#efeff1', 'Переименовать');
  editBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    e.preventDefault();
    const currentAlias = getAlias(login);
    const newAlias = window.prompt(`Новое имя для ${login}:`, currentAlias ?? '');
    if (newAlias !== null) onSetAlias(login, newAlias.trim());
  });
  btnWrap.appendChild(editBtn);

  if (isCurrentlyAliased) {
    const resetBtn = makeIconBtn(RESET_ICON_SVG, '#ff4444', '#ff6666', 'Сбросить ник');
    resetBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      e.preventDefault();
      onRemoveAlias(login);
    });
    btnWrap.appendChild(resetBtn);
  }

  nameEl.insertAdjacentElement('afterend', btnWrap);
}

export function removeCardAliasControls(cardEl: Element): void {
  cardEl.querySelectorAll('[data-tsr-alias-controls]').forEach((el) => el.remove());
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
