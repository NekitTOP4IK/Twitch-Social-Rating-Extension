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
  injectCardAliasControls,
  removeCardAliasControls,
  scheduleBatchReapply,
} from './alias-injector';

function getCurrentChannel(): string {
  const { hostname, pathname } = window.location;

  if (hostname === 'dashboard.twitch.tv') {
    const m = pathname.match(/\/(?:popout\/)?u\/([a-z0-9_]+)/i);
    return m ? m[1].toLowerCase() : '';
  }

  const modMatch = pathname.match(/^\/(?:popout\/)?moderator\/([a-z0-9_]+)/i);
  if (modMatch) return modMatch[1].toLowerCase();

  const m = pathname.match(/^\/([a-z0-9_]+)/i);
  return m ? m[1].toLowerCase() : '';
}

const processing = new WeakSet<Element>();

async function handleElement(el: Element): Promise<void> {
  const card = detectCardLogin(el);
  if (!card) return;
  if (processing.has(card.element)) return;
  processing.add(card.element);
  try {
    const channel = getCurrentChannel();
    const rating = await fetchRating(card.login, channel);
    await injectBadge(card, rating, channel);

    // Apply alias to card username immediately
    applyAliasesToViewerCard(card.element, card.login);

    // Inject edit/reset controls into the card
    injectCardAliasControls(
      card.element,
      card.login,
      async (login, alias) => {
        await setAlias(login, alias);
        scheduleBatchReapply();
      },
      async (login) => {
        await removeAlias(login);
        scheduleBatchReapply();
      },
    );
  } finally {
    processing.delete(card.element);
  }
}

function observe(): void {
  const chatLinesToReapply = new Set<Element>();
  const cardsToReapply = new Set<Element>();

  const observer = new MutationObserver((mutations) => {
    const newChatLines: Element[] = [];

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
          newChatLines.push(node);
        }
        node.querySelectorAll('.chat-line__message').forEach((el) => newChatLines.push(el));

        // Chat lines (7TV standalone)
        if (node.classList.contains('seventv-user-message')) {
          const wrapper = node.closest('.chat-line__message');
          if (wrapper && !newChatLines.includes(wrapper)) newChatLines.push(wrapper);
        }
        node.querySelectorAll('.seventv-user-message').forEach((el) => {
          const wrapper = el.closest('.chat-line__message');
          if (wrapper && !newChatLines.includes(wrapper)) newChatLines.push(wrapper);
        });

        // Leaderboard
        if (
          node.matches?.('[data-test-selector="leaderboard-item-name-test-selector"]') ||
          node.querySelector('[data-test-selector="leaderboard-item-name-test-selector"]')
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
        const card = mutation.target.closest('.seventv-user-card, .viewer-card');
        if (card) cardsToReapply.add(card);

        // Vue may swap text nodes inside username spans — queue the parent line
        const target = mutation.target;
        const isUserNameSpan =
          target.classList?.contains('seventv-chat-user-username') ||
          target.classList?.contains('chat-author__display-name') ||
          target.closest('.seventv-chat-user-username') != null ||
          target.closest('.chat-author__display-name') != null;
        if (isUserNameSpan) {
          const line = target.closest('.chat-line__message, .seventv-user-message');
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
            parent.closest('.seventv-chat-user-username') != null ||
            parent.closest('.chat-author__display-name') != null;
          if (isUserNameSpan) {
            const line = parent.closest('.chat-line__message, .seventv-user-message');
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
          if (!detected) continue;
          applyAliasesToViewerCard(detected.element, detected.login);
          if (!detected.element.querySelector('[data-tsr-alias-controls]')) {
            injectCardAliasControls(
              detected.element,
              detected.login,
              async (login, alias) => {
                await setAlias(login, alias);
                scheduleBatchReapply();
              },
              async (login) => {
                await removeAlias(login);
                scheduleBatchReapply();
              },
            );
          }
        }
      });
    }

    // Batch-apply aliases to new chat lines
    if (newChatLines.length > 0) {
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
  await initAliasManager();

  applyAliasesToAllChat();
  applyAliasesToLeaderboard();
  applyAliasesToSideNav();

  observe();
  initWebSocket();
  watchNavigation();

  onAliasChange(() => {
    scheduleBatchReapply();
  });
})();
