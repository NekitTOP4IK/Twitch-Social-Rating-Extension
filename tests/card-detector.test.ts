import { detectCardLogin } from '../src/content/card-detector';

function el(html: string): Element {
  const div = document.createElement('div');
  div.innerHTML = html.trim();
  return div.firstElementChild as Element;
}

describe('detectCardLogin — 7TV', () => {
  it('extracts login from seventv-user-card usertag href', () => {
    const card = el(`
      <div class="seventv-user-card">
        <a class="seventv-user-card-usertag" href="https://twitch.tv/balbe5ich"></a>
      </div>
    `);
    const result = detectCardLogin(card);
    expect(result?.type).toBe('seventv');
    expect(result?.login).toBe('balbe5ich');
  });

  it('lowercases the login', () => {
    const card = el(`
      <div class="seventv-user-card">
        <a class="seventv-user-card-usertag" href="https://twitch.tv/StreamerName"></a>
      </div>
    `);
    expect(detectCardLogin(card)?.login).toBe('streamername');
  });

  it('detects 7TV card nested inside draggable float wrapper', () => {
    const wrapper = el(`
      <div class="draggable-container seventv-user-card-float">
        <main class="seventv-user-card-container">
          <div class="seventv-user-card">
            <a class="seventv-user-card-usertag" href="https://twitch.tv/testuser"></a>
          </div>
        </main>
      </div>
    `);
    const result = detectCardLogin(wrapper);
    expect(result?.type).toBe('seventv');
    expect(result?.login).toBe('testuser');
  });

  it('returns null when seventv card has no usertag href', () => {
    const card = el(`<div class="seventv-user-card"><span>no link</span></div>`);
    expect(detectCardLogin(card)).toBeNull();
  });
});

describe('detectCardLogin — native Twitch', () => {
  it('extracts login from user-card-login-name target', () => {
    const layer = el(`
      <div class="viewer-card-layer">
        <div>
          <p data-a-target="user-card-login-name">NightBot</p>
        </div>
      </div>
    `);
    const result = detectCardLogin(layer);
    expect(result?.type).toBe('twitch');
    expect(result?.login).toBe('nightbot');
  });

  it('falls back to href /username pattern', () => {
    const layer = el(`
      <div class="viewer-card-layer">
        <div><a href="/somestreamer">somestreamer</a></div>
      </div>
    `);
    const result = detectCardLogin(layer);
    expect(result?.login).toBe('somestreamer');
  });

  it('returns null for empty viewer-card-layer', () => {
    const layer = el(`<div class="viewer-card-layer"></div>`);
    expect(detectCardLogin(layer)).toBeNull();
  });

  it('detects nested viewer-card-layer', () => {
    const wrapper = el(`
      <div class="chat-room__viewer-card" data-a-target="chat-user-card">
        <div class="viewer-card-layer">
          <p data-a-target="user-card-login-name">Coolstreamer</p>
        </div>
      </div>
    `);
    const result = detectCardLogin(wrapper);
    expect(result?.login).toBe('coolstreamer');
  });
});

describe('detectCardLogin — unrelated', () => {
  it('returns null for random element', () => {
    const div = el(`<div class="chat-message">hello</div>`);
    expect(detectCardLogin(div)).toBeNull();
  });
});
