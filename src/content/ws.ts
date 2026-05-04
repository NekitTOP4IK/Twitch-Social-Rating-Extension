const WS_BASE = 'ws://localhost:8000';
const RECONNECT_DELAY = 5000;

export type RatingUpdateCallback = (login: string, score: number) => void;

let socket: WebSocket | null = null;
let activeChannel: string | null = null;
let onUpdateCb: RatingUpdateCallback | null = null;

function connect(channelLogin: string): void {
  socket = new WebSocket(`${WS_BASE}/ws/${encodeURIComponent(channelLogin)}`);

  socket.addEventListener('message', (ev) => {
    try {
      const data = JSON.parse(ev.data as string);
      if (data.type === 'rating_update' && onUpdateCb) {
        onUpdateCb(data.login as string, data.score as number);
      }
    } catch { /* ignore */ }
  });

  socket.addEventListener('close', () => {
    if (activeChannel === channelLogin) {
      setTimeout(() => {
        if (activeChannel === channelLogin) connect(channelLogin);
      }, RECONNECT_DELAY);
    }
  });
}

export function connectWebSocket(
  channelLogin: string,
  onUpdate: RatingUpdateCallback,
): void {
  if (socket && activeChannel === channelLogin) return;
  disconnectWebSocket();
  activeChannel = channelLogin;
  onUpdateCb = onUpdate;
  connect(channelLogin);
}

export function disconnectWebSocket(): void {
  activeChannel = null;
  onUpdateCb = null;
  if (socket) {
    socket.close();
    socket = null;
  }
}
