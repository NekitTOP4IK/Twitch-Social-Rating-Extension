import { getAlias, getAllAliases } from '../src/content/alias-manager';
import {
  applyAliasesToAllChat,
  applyAliasesToChatLine,
  applyAliasesToLeaderboard,
  applyAliasesToOpenCards,
  applyAliasesToViewerCard,
} from '../src/content/alias-injector';

jest.mock('../src/content/alias-manager', () => ({
  getAlias: jest.fn(),
  getAllAliases: jest.fn(),
  isAliased: jest.fn(),
}));

const mockedGetAlias = getAlias as jest.MockedFunction<typeof getAlias>;
const mockedGetAllAliases = getAllAliases as jest.MockedFunction<typeof getAllAliases>;

function el(html: string): Element {
  const div = document.createElement('div');
  div.innerHTML = html.trim();
  return div.firstElementChild as Element;
}

function setAliases(aliases: Record<string, string>): void {
  mockedGetAlias.mockImplementation((login: string) => aliases[login.toLowerCase()] ?? null);
  mockedGetAllAliases.mockReturnValue(aliases);
}

describe('alias injector', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
    mockedGetAlias.mockReset();
    mockedGetAllAliases.mockReset();
  });

  it('keeps standalone 7TV aliases stable across repeated passes and restores them', () => {
    document.body.innerHTML = `
      <span class="seventv-user-message">
        <div class="seventv-chat-user">
          <span class="seventv-chat-user-username"><span><span>mectorn_</span></span></span>
        </div>
      </span>
    `;

    setAliases({ mectorn_: 'StoneName' });
    applyAliasesToAllChat();
    applyAliasesToAllChat();

    const name = document.querySelector('.seventv-chat-user-username') as Element;
    expect(name.textContent).toBe('StoneName');
    expect(name.getAttribute('data-tsr-login')).toBe('mectorn_');

    setAliases({});
    applyAliasesToAllChat();
    expect(name.textContent).toBe('mectorn_');
  });

  it('handles 7TV reusing an aliased username node for another chatter', () => {
    const msg = el(`
      <span class="seventv-user-message">
        <div class="seventv-chat-user">
          <span class="seventv-chat-user-username"><span><span>mectorn_</span></span></span>
        </div>
      </span>
    `);
    document.body.appendChild(msg);

    setAliases({ mectorn_: 'StoneName', otheruser: 'OtherAlias' });
    applyAliasesToChatLine(msg);

    const name = msg.querySelector('.seventv-chat-user-username') as Element;
    expect(name.textContent).toBe('StoneName');

    const textNode = name.querySelector('span span')?.firstChild as Text;
    textNode.textContent = 'otheruser';
    applyAliasesToChatLine(msg);

    expect(name.textContent).toBe('OtherAlias');
    expect(name.getAttribute('data-tsr-login')).toBe('otheruser');
  });

  it('restores native viewer card name and labels when an alias is removed', () => {
    const card = el(`
      <div class="viewer-card-layer">
        <div class="viewer-card">
          <div class="viewer-card-header__display-name">
            <a class="tw-link" href="/nightbot">NightBot</a>
          </div>
          <button data-a-target="follow-button" aria-label="Follow nightbot">Follow</button>
        </div>
      </div>
    `);

    setAliases({ nightbot: 'NightAlias' });
    applyAliasesToViewerCard(card, 'nightbot');

    const link = card.querySelector('.viewer-card-header__display-name a') as Element;
    const follow = card.querySelector('[data-a-target="follow-button"]') as Element;
    expect(link.textContent).toBe('NightAlias');
    expect(follow.getAttribute('aria-label')).toBe('Follow NightAlias');

    setAliases({});
    applyAliasesToViewerCard(card, 'nightbot');

    expect(link.textContent).toBe('NightBot');
    expect(follow.getAttribute('aria-label')).toBe('Follow nightbot');
  });

  it('rewrites native message history author names', () => {
    document.body.innerHTML = `
      <span class="message-author__display-name" data-test-selector="message-username" style="color: rgb(139, 88, 255);">kanoyo_993</span>
    `;

    setAliases({ kanoyo_993: 'CaveCoder' });
    applyAliasesToAllChat();
    applyAliasesToAllChat();

    const name = document.querySelector('.message-author__display-name') as Element;
    expect(name.textContent).toBe('CaveCoder');
    expect(name.getAttribute('data-tsr-login')).toBe('kanoyo_993');

    setAliases({});
    applyAliasesToAllChat();
    expect(name.textContent).toBe('kanoyo_993');
  });

  it('rewrites native viewer card profile links without waiting for the header wrapper', () => {
    const card = el(`
      <div class="viewer-card-layer">
        <a class="ScCoreLink-sc-16kq0mq-0 dEeZDR tw-link" rel="noopener noreferrer" href="/kanoyo_993" target="_blank">kanoyo_993</a>
      </div>
    `);

    setAliases({ kanoyo_993: 'CaveCoder' });
    applyAliasesToViewerCard(card, 'kanoyo_993');

    const link = card.querySelector('a.tw-link') as Element;
    expect(link.textContent).toBe('CaveCoder');
    expect(link.getAttribute('data-tsr-login')).toBe('kanoyo_993');
  });

  it('re-applies aliases to an already opened native viewer-card using data-tsr-login', () => {
    document.body.innerHTML = `
      <div class="viewer-card">
        <div class="viewer-card-header__display-name">
          <h4>
            <a class="ScCoreLink-sc-16kq0mq-0 dEeZDR tw-link" href="/kanoyo_993" target="_blank" data-tsr-login="kanoyo_993">kanoyo_993</a>
            <span data-tsr-alias-controls=""></span>
          </h4>
        </div>
      </div>
    `;

    setAliases({ kanoyo_993: 'CaveCoder' });
    applyAliasesToOpenCards();

    const link = document.querySelector('a.tw-link') as Element;
    expect(link.textContent).toBe('CaveCoder');
    expect(link.getAttribute('data-tsr-aliased')).toBe('true');
  });

  it('rewrites the pinned-by username without removing badges', () => {
    document.body.innerHTML = `
      <div class="pinned-chat__pinned-by">
        <p>
          Pinned by
          <span><div><img alt="Broadcaster" class="chat-badge"></div></span>
          kanoyo_993
        </p>
      </div>
    `;

    setAliases({ kanoyo_993: 'CaveCoder' });
    applyAliasesToAllChat();

    const pinned = document.querySelector('.pinned-chat__pinned-by') as Element;
    expect(pinned.textContent).toContain('CaveCoder');
    expect(pinned.querySelector('.chat-badge')).not.toBeNull();
    expect(pinned.getAttribute('data-tsr-login')).toBe('kanoyo_993');

    setAliases({});
    applyAliasesToAllChat();
    expect(pinned.textContent).toContain('kanoyo_993');
    expect(pinned.querySelector('.chat-badge')).not.toBeNull();
  });

  it('rewrites the pinned message author chatter-name', () => {
    document.body.innerHTML = `
      <span class="chatter-name chatter-name--no-outline" role="button" tabindex="0">
        <span><span style="color: rgb(0, 0, 255);">kanoyo_993</span></span>
      </span>
    `;

    setAliases({ kanoyo_993: 'CaveCoder' });
    applyAliasesToAllChat();

    const name = document.querySelector('.chatter-name') as Element;
    expect(name.textContent?.trim()).toBe('CaveCoder');
    expect(name.getAttribute('data-tsr-login')).toBe('kanoyo_993');
  });

  it('rewrites autocomplete mention display while keeping original search target', () => {
    document.body.innerHTML = `
      <div class="autocomplete-match-list">
        <button data-a-target="@kanoyo_993" data-click-index="0">
          <div><p>kanoyo_993</p></div>
        </button>
      </div>
    `;

    setAliases({ kanoyo_993: 'CaveCoder' });
    applyAliasesToAllChat();

    const button = document.querySelector('button[data-a-target]') as Element;
    const label = button.querySelector('p') as Element;
    expect(button.getAttribute('data-a-target')).toBe('@kanoyo_993');
    expect(label.textContent).toBe('CaveCoder');
    expect(label.getAttribute('data-tsr-login')).toBe('kanoyo_993');
  });

  it('rewrites reply preview mentioned username with reply-line class', () => {
    document.body.innerHTML = `
      <p title="ответьте на мое сообщение что угодно пж">
        Replying to <span dir="auto" class="reply-line--mentioned">@kanoyo_993</span>:
        <span dir="auto">ответьте на мое сообщение что угодно пж</span>
      </p>
    `;

    setAliases({ kanoyo_993: 'CaveCoder' });
    applyAliasesToAllChat();

    const mention = document.querySelector('.reply-line--mentioned') as Element;
    const body = document.querySelectorAll('p span[dir="auto"]')[1] as Element;
    expect(mention.textContent).toBe('@CaveCoder');
    expect(mention.getAttribute('data-tsr-login')).toBe('kanoyo_993');
    expect(body.textContent).toBe('ответьте на мое сообщение что угодно пж');
  });

  it('rewrites reply preview mentioned username without reply-line class', () => {
    document.body.innerHTML = `
      <p title="в моём городе есть бутик">
        Replying to <span dir="auto">@l1kus_uwu</span>:
        <span dir="auto">в моём городе есть бутик под названием "АНИМЕ РОК ШОП" feaky</span>
      </p>
    `;

    setAliases({ l1kus_uwu: 'RockAlias' });
    applyAliasesToAllChat();

    const mention = document.querySelector('p span[dir="auto"]') as Element;
    const body = document.querySelectorAll('p span[dir="auto"]')[1] as Element;
    expect(mention.textContent).toBe('@RockAlias');
    expect(mention.getAttribute('data-tsr-login')).toBe('l1kus_uwu');
    expect(body.textContent).toContain('АНИМЕ РОК ШОП');
  });

  it('rewrites gift sub inline private callout sender without touching the thank button', () => {
    document.body.innerHTML = `
      <div>
        <div class="inline-private-callout-line__icon"></div>
        <div>
          <span>You received a Gift Sub from isweettea_</span>
        </div>
        <div>
          <button><div data-a-target="tw-core-button-label-text">Thank</div></button>
        </div>
      </div>
    `;

    setAliases({ isweettea_: 'SweetAlias' });
    applyAliasesToAllChat();

    const text = document.querySelector('span') as Element;
    const button = document.querySelector('[data-a-target="tw-core-button-label-text"]') as Element;
    expect(text.textContent).toBe('You received a Gift Sub from SweetAlias');
    expect(text.getAttribute('data-tsr-login')).toBe('isweettea_');
    expect(button.textContent).toBe('Thank');

    setAliases({});
    applyAliasesToAllChat();
    expect(text.textContent).toBe('You received a Gift Sub from isweettea_');
  });

  it('rewrites top clips leaderboard usernames from strong title', () => {
    document.body.innerHTML = `
      <div class="Layout-sc-1xcs6mc-0 iWjIRz username--CXGgt">
        <div>
          <span>
            <button>
              <strong title="elishach4n">elishach4n</strong>
            </button>
          </span>
        </div>
        <div><span>МОГГНУЛ</span></div>
      </div>
    `;

    setAliases({ elishach4n: 'ClipAlias' });
    applyAliasesToLeaderboard();

    const name = document.querySelector('strong[title]') as Element;
    expect(name.textContent).toBe('ClipAlias');
    expect(name.getAttribute('title')).toBe('elishach4n');

    setAliases({});
    applyAliasesToLeaderboard();
    expect(name.textContent).toBe('elishach4n');
  });

  it('rewrites 7TV mention-token usernames inside card history by mentioned login', () => {
    const card = el(`
      <div class="seventv-user-card">
        <a class="seventv-user-card-usertag" href="https://twitch.tv/kanoyo_993">
          <span class="seventv-chat-user-username"><span><span>kanoyo_993</span></span></span>
        </a>
        <div class="seventv-user-card-message-timeline-list">
          <span class="seventv-chat-message-body">
            <span class="mention-token">
              <div class="seventv-chat-user">
                <span class="seventv-chat-user-username" data-tsr-login="kanoyo_993">
                  <span><span>@</span><span>isweettea_</span></span>
                </span>
              </div>
            </span>
            <span class="text-token"> спасибо большое!!!</span>
          </span>
        </div>
      </div>
    `);

    setAliases({ kanoyo_993: 'OwnerAlias', isweettea_: 'SweetAlias' });
    applyAliasesToViewerCard(card, 'kanoyo_993');

    const owner = card.querySelector('.seventv-user-card-usertag .seventv-chat-user-username') as Element;
    const mention = card.querySelector('.mention-token .seventv-chat-user-username') as Element;
    expect(owner.textContent).toBe('OwnerAlias');
    expect(mention.textContent?.replace(/\s+/g, '')).toBe('@SweetAlias');
    expect(mention.getAttribute('data-tsr-login')).toBe('isweettea_');

    setAliases({});
    applyAliasesToViewerCard(card, 'kanoyo_993');
    expect(mention.textContent?.replace(/\s+/g, '')).toBe('@isweettea_');
  });

  it('rewrites 7TV reply message part mention without touching replied text', () => {
    document.body.innerHTML = `
      <div class="seventv-reply-part">
        <div class="seventv-chat-reply-icon"></div>
        <div class="seventv-reply-message-part">Replying to @kanoyo_993: ага</div>
      </div>
    `;

    setAliases({ kanoyo_993: 'CaveCoder' });
    applyAliasesToAllChat();

    const reply = document.querySelector('.seventv-reply-message-part') as Element;
    expect(reply.textContent).toBe('Replying to @CaveCoder: ага');
    expect(reply.getAttribute('data-tsr-login')).toBe('kanoyo_993');

    setAliases({});
    applyAliasesToAllChat();
    expect(reply.textContent).toBe('Replying to @kanoyo_993: ага');
  });
});
