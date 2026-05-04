import { detectCardLogin } from './card-detector';
import { injectBadge, updateBadgeScore } from './card-injector';
import { fetchRating } from './api';
import { connectWebSocket, disconnectWebSocket } from './ws';

function getCurrentChannel(): string {
  const { hostname, pathname } = window.location;

  // dashboard.twitch.tv/u/{channel} or dashboard.twitch.tv/popout/u/{channel}
  if (hostname === 'dashboard.twitch.tv') {
    const m = pathname.match(/\/(?:popout\/)?u\/([a-z0-9_]+)/i);
    return m ? m[1].toLowerCase() : '';
  }

  // www.twitch.tv/moderator/{channel} or /popout/moderator/{channel}
  const modMatch = pathname.match(/^\/(?:popout\/)?moderator\/([a-z0-9_]+)/i);
  if (modMatch) return modMatch[1].toLowerCase();

  // Regular: www.twitch.tv/{channel}
  const m = pathname.match(/^\/([a-z0-9_]+)/i);
  return m ? m[1].toLowerCase() : '';
}

// Prevent duplicate concurrent injections for the same card element
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
  } finally {
    processing.delete(card.element);
  }
}

function observe(): void {
  const observer = new MutationObserver((mutations) => {
    for (const mutation of mutations) {
      for (const node of mutation.addedNodes) {
        if (!(node instanceof Element)) continue;
        handleElement(node);
        node
          .querySelectorAll('[class*="viewer-card-layer"], .seventv-user-card')
          .forEach((el) => handleElement(el));
      }
      if (
        mutation.type === 'childList' &&
        mutation.target instanceof Element &&
        Array.from(mutation.target.classList).some((c) => c.startsWith('viewer-card-layer')) &&
        mutation.target.children.length > 0
      ) {
        handleElement(mutation.target as Element);
      }
    }
  });

  observer.observe(document.body, { childList: true, subtree: true });
}

function initWebSocket(): void {
  const channel = getCurrentChannel();
  if (!channel) return;
  connectWebSocket(channel, (login, score) => updateBadgeScore(login, score));
}

// Reconnect WS when navigating between channels (Twitch is a SPA)
let lastChannel = '';
function watchNavigation(): void {
  const check = () => {
    const ch = getCurrentChannel();
    if (ch && ch !== lastChannel) {
      lastChannel = ch;
      disconnectWebSocket();
      initWebSocket();
    }
  };
  // Twitch pushes history via pushState
  const origPush = history.pushState.bind(history);
  history.pushState = (...args) => {
    origPush(...args);
    check();
  };
  window.addEventListener('popstate', check);
}

observe();
initWebSocket();
watchNavigation();
