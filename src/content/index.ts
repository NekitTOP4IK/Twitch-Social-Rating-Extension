import { debug, error } from '../utils/logger';
import { detectCardLogin } from './card-detector';
import { injectBadge, updateBadgeScore } from './card-injector';
import { fetchRating } from './api';
import { connectWebSocket, disconnectWebSocket } from './ws';
import {
  initAliasManager,
  onAliasChange,
  setAlias,
  removeAlias,
} from './alias-manager';
import {
  applyAliasesToChatLine,
  applyAliasesToAllChat,
  applyAliasesToLeaderboard,
  applyAliasesToSideNav,
  applyAliasesToViewerCard,
  applyAliasesToOpenCards,
  applyAliasesToPinnedChat,
  applyAliasesToAutocomplete,
  applyAliasesToReplyPreviews,
  applyAliasesToInlineCallouts,
  applyAliasesToSevenTVPrompts,
  injectCardAliasControls,
  removeCardAliasControls,
  scheduleBatchReapply,
} from './alias-injector';

function getCurrentChannel(): string {
  const { hostname, pathname } = window.location;
  debug('content', 'getCurrentChannel hostname=', hostname, 'pathname=', pathname);

  if (hostname === 'dashboard.twitch.tv') {
    const m = pathname.match(/\/(?:popout\/)?u\/([a-z0-9_]+)/i);
    const ch = m ? m[1].toLowerCase() : '';
    debug('content', 'dashboard channel=', ch);
    return ch;
  }

  const modMatch = pathname.match(/^\/(?:popout\/)?moderator\/([a-z0-9_]+)/i);
  if (modMatch) {
    debug('content', 'moderator channel=', modMatch[1].toLowerCase());
    return modMatch[1].toLowerCase();
  }

  const popoutMatch = pathname.match(/^\/popout\/([a-z0-9_]+)/i);
  if (popoutMatch) {
    debug('content', 'popout channel=', popoutMatch[1].toLowerCase());
    return popoutMatch[1].toLowerCase();
  }

  const m = pathname.match(/^\/([a-z0-9_]+)/i);
  const ch = m ? m[1].toLowerCase() : '';
  debug('content', 'channel=', ch);
  return ch;
}

const processing = new WeakSet<Element>();
const NAME_SELECTOR = [
  '.chat-author__display-name',
  '.message-author__display-name',
  '.chatter-name',
  '.autocomplete-match-list button[data-a-target^="@"] p',
  'p span[dir="auto"]',
  '.seventv-reply-message-part',
  '.seventv-confirm-prompt-body .seventv-chat-user-username',
  '.seventv-chat-user-username',
].join(', ');

async function handleElement(el: Element): Promise<void> {
  const card = detectCardLogin(el);
  if (!card) return;

  // Keep visible usernames seamless; rating fetch/injection can finish later.
  applyAliasesToViewerCard(card.element, card.login);

  if (processing.has(card.element)) return;
  processing.add(card.element);
  try {
    const channel = getCurrentChannel();
    debug('content', 'handleElement card.login=', card.login, 'channel=', channel, 'type=', card.type);
    const rating = await fetchRating(card.login, channel);
    debug('content', 'handleElement rating=', rating);
    await injectBadge(card, rating, channel);

    // Inject edit/reset controls into the card
    injectCardAliasControls(
      card.element,
      card.login,
      async (login, alias) => {
        await setAlias(login, alias);
        scheduleBatchReapply();
        refreshOpenCardAliases();
      },
      async (login) => {
        await removeAlias(login);
        scheduleBatchReapply();
        refreshOpenCardAliases();
      },
    );

    // Alias state may arrive while rating is loading; enforce it again after card UI work.
    applyAliasesToViewerCard(card.element, card.login);
  } finally {
    processing.delete(card.element);
  }
}

function refreshOpenCardAliases(): void {
  applyAliasesToOpenCards();

  document.querySelectorAll('[class*="viewer-card-layer"], .seventv-user-card').forEach((el) => {
    const detected = detectCardLogin(el);
    if (!detected) return;

    applyAliasesToViewerCard(detected.element, detected.login);
    removeCardAliasControls(detected.element);
    injectCardAliasControls(
      detected.element,
      detected.login,
      async (login, alias) => {
        await setAlias(login, alias);
        scheduleBatchReapply();
        refreshOpenCardAliases();
      },
      async (login) => {
        await removeAlias(login);
        scheduleBatchReapply();
        refreshOpenCardAliases();
      },
    );
  });
}

function observe(): void {
  const chatLinesToReapply = new Set<Element>();
  const cardsToReapply = new Set<Element>();

  const observer = new MutationObserver((mutations) => {
    const newChatLines = new Set<Element>();

    for (const mutation of mutations) {
      for (const node of mutation.addedNodes) {
        if (!(node instanceof Element)) continue;

        // Cards
        handleElement(node);
        node
          .querySelectorAll('[class*="viewer-card-layer"], .seventv-user-card')
          .forEach((el) => handleElement(el));

        // Chat lines (native)
        if (node.classList.contains('chat-line__message')) {
          newChatLines.add(node);
        }
        node.querySelectorAll('.chat-line__message').forEach((el) => newChatLines.add(el));

        // Native message history and other username-only fragments.
        if (node.matches(NAME_SELECTOR)) {
          newChatLines.add(node);
        }
        node.querySelectorAll(NAME_SELECTOR).forEach((el) => newChatLines.add(el));

        // Pinned chat and autocomplete mention tray contain username text outside normal chat lines.
        if (
          node.matches('.pinned-chat__pinned-by, .chatter-name, .autocomplete-match-list') ||
          node.matches('.inline-private-callout-line__icon') ||
          node.matches('p span[dir="auto"], .seventv-reply-message-part, .seventv-confirm-prompt-body') ||
          node.querySelector('.pinned-chat__pinned-by, .chatter-name, .autocomplete-match-list, .inline-private-callout-line__icon, p span[dir="auto"], .seventv-reply-message-part, .seventv-confirm-prompt-body')
        ) {
          scheduleBatchReapply();
        }

        // Chat lines (7TV standalone)
        if (node.classList.contains('seventv-user-message')) {
          const wrapper = node.closest('.chat-line__message');
          if (wrapper) newChatLines.add(wrapper);
          if (!wrapper) newChatLines.add(node);
        }
        node.querySelectorAll('.seventv-user-message').forEach((el) => {
          const wrapper = el.closest('.chat-line__message');
          if (wrapper) newChatLines.add(wrapper);
          if (!wrapper) newChatLines.add(el);
        });

        // Leaderboard
        if (
          node.matches?.('[data-test-selector="leaderboard-item-name-test-selector"]') ||
          node.matches?.('[class*="channelLeaderboardHeaderRunnerUpEntry__username"], [class*="username--"]') ||
          node.querySelector('[data-test-selector="leaderboard-item-name-test-selector"], [class*="channelLeaderboardHeaderRunnerUpEntry__username"], [class*="username--"]')
        ) {
          scheduleBatchReapply();
        }

        // Side nav
        if (
          node.classList?.contains('side-nav-card') ||
          node.querySelector('.side-nav-card')
        ) {
          scheduleBatchReapply();
        }
      }

      // Native card layer children changed (card opened)
      if (
        mutation.type === 'childList' &&
        mutation.target instanceof Element &&
        Array.from(mutation.target.classList).some((c) => c.startsWith('viewer-card-layer')) &&
        mutation.target.children.length > 0
      ) {
        handleElement(mutation.target as Element);
      }

      // Re-apply aliases inside existing cards when Vue/Twitch re-renders content
      if (mutation.type === 'childList' && mutation.target instanceof Element) {
        const card = mutation.target.closest('.seventv-user-card, .viewer-card, [class*="viewer-card-layer"]');
        if (card) cardsToReapply.add(card);

        // Vue may swap text nodes inside username spans — queue the parent line
        const target = mutation.target;
        const isUserNameSpan =
          target.classList?.contains('seventv-chat-user-username') ||
          target.classList?.contains('chat-author__display-name') ||
          target.classList?.contains('message-author__display-name') ||
          target.closest('.seventv-chat-user-username') != null ||
          target.closest('.chat-author__display-name') != null ||
          target.closest('.message-author__display-name') != null;
        if (isUserNameSpan) {
          const line = target.closest('.chat-line__message, .seventv-user-message') ?? target.closest(NAME_SELECTOR);
          if (line) chatLinesToReapply.add(line);
        }
      }

      // Vue edits text nodes directly (textContent / node.data)
      if (mutation.type === 'characterData' && mutation.target instanceof Text) {
        const parent = mutation.target.parentElement;
        if (parent) {
          const isUserNameSpan =
            parent.classList?.contains('seventv-chat-user-username') ||
            parent.classList?.contains('chat-author__display-name') ||
            parent.classList?.contains('message-author__display-name') ||
            parent.closest('.seventv-chat-user-username') != null ||
            parent.closest('.chat-author__display-name') != null ||
            parent.closest('.message-author__display-name') != null;
          if (isUserNameSpan) {
            const line = parent.closest('.chat-line__message, .seventv-user-message') ?? parent.closest(NAME_SELECTOR);
            if (line) chatLinesToReapply.add(line);
          }
        }
      }
    }

    // Process cards that need re-applying (debounce via requestAnimationFrame)
    if (cardsToReapply.size > 0) {
      const cards = Array.from(cardsToReapply);
      cardsToReapply.clear();
      requestAnimationFrame(() => {
        for (const card of cards) {
          const detected = detectCardLogin(card);
          if (!detected) {
            applyAliasesToOpenCards();
            continue;
          }

          applyAliasesToViewerCard(detected.element, detected.login);
          if (!detected.element.querySelector('[data-tsr-alias-controls]')) {
            injectCardAliasControls(
              detected.element,
              detected.login,
              async (login, alias) => {
                await setAlias(login, alias);
                scheduleBatchReapply();
                refreshOpenCardAliases();
              },
              async (login) => {
                await removeAlias(login);
                scheduleBatchReapply();
                refreshOpenCardAliases();
              },
            );
          }
        }
      });
    }

    // Batch-apply aliases to new chat lines
    if (newChatLines.size > 0) {
      requestAnimationFrame(() => {
        for (const line of newChatLines) {
          applyAliasesToChatLine(line);
        }
      });
    }

    // Re-apply aliases to chat lines whose text nodes were mutated by Vue/React
    if (chatLinesToReapply.size > 0) {
      const lines = Array.from(chatLinesToReapply);
      chatLinesToReapply.clear();
      requestAnimationFrame(() => {
        for (const line of lines) {
          applyAliasesToChatLine(line);
        }
      });
    }
  });

  observer.observe(document.body, { childList: true, subtree: true, characterData: true });
}

function initWebSocket(): void {
  const channel = getCurrentChannel();
  if (!channel) return;
  connectWebSocket(channel, (login, score) => updateBadgeScore(login, score));
}

let lastChannel = '';
function watchNavigation(): void {
  const check = () => {
    const ch = getCurrentChannel();
    if (ch && ch !== lastChannel) {
      lastChannel = ch;
      disconnectWebSocket();
      initWebSocket();
      scheduleBatchReapply();
    }
  };
  const origPush = history.pushState.bind(history);
  history.pushState = (...args) => {
    origPush(...args);
    check();
  };
  window.addEventListener('popstate', check);
}

// ── Startup ─────────────────────────────────────────────────────────────────

(async () => {
  debug('content', 'startup BACKEND_URL=', (window as any).__BACKEND_URL__ ?? 'n/a');
  await initAliasManager();

  applyAliasesToAllChat();
  applyAliasesToOpenCards();
  applyAliasesToPinnedChat();
  applyAliasesToAutocomplete();
  applyAliasesToReplyPreviews();
  applyAliasesToInlineCallouts();
  applyAliasesToSevenTVPrompts();
  applyAliasesToLeaderboard();
  applyAliasesToSideNav();

  observe();
  initWebSocket();
  watchNavigation();

  onAliasChange(() => {
    scheduleBatchReapply();
    refreshOpenCardAliases();
  });
})();
