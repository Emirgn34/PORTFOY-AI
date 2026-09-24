import WebSocket from 'ws';
import { automationDb, recordMonitor } from './automationDb.js';
import { ingestCatalyst } from './catalystNews.js';
import { deliverNotifications } from './pushNotifications.js';

const sb = automationDb();
const token = process.env.BENZINGA_API_KEY;
if (!token) throw new Error('Gerçek zamanlı haber akışı için BENZINGA_API_KEY gerekli.');
let socket, heartbeat, retry, stopping = false, attempts = 0, chain = Promise.resolve();
let lastMessageAt = null;
async function status(connected, error = null) {
  await recordMonitor(sb, 'news', { mode: 'stream', connected, lastMessageAt, error, note: 'Benzinga canlı akışı. İletim süresi sağlayıcı ve telefon bağlantısına bağlıdır.' }).catch(() => {});
}
function connect() {
  socket = new WebSocket(`wss://api.benzinga.com/api/v1/news/stream?token=${encodeURIComponent(token)}`);
  socket.on('open', () => {
    attempts = 0; status(true); socket.send('replay');
    heartbeat = setInterval(() => { if (socket.readyState === WebSocket.OPEN) { socket.send('ping'); status(true); } }, 30_000);
  });
  socket.on('message', (raw) => {
    let message;
    try { message = JSON.parse(raw.toString()); } catch { return; }
    const content = message?.data?.content;
    if (!content || String(message.data.action).toLowerCase() === 'deleted') return;
    lastMessageAt = new Date().toISOString();
    chain = chain.then(async () => {
      await ingestCatalyst(sb, { id: content.id, provider: 'Benzinga', title: content.title,
        symbols: (content.stocks ?? []).filter((s) => !s.exchange || /NASDAQ|NYSE|AMEX/i.test(s.exchange)).map((s) => s.name),
        publishedAt: content.created, url: content.url });
      await deliverNotifications(sb);
    }).catch(() => status(true, 'Haber kaydı veya bildirim iletimi başarısız; bağlantı tekrar deneniyor.'));
  });
  socket.on('error', () => status(false, 'Haber bağlantısı kurulamadı. Abonelik ve bağlantı kontrol edilmeli.'));
  socket.on('close', () => {
    clearInterval(heartbeat); status(false);
    if (!stopping) retry = setTimeout(connect, Math.min(60_000, 1000 * 2 ** Math.min(++attempts, 6)));
  });
}
connect();
// Yeni ileti olmasa da geçici push hatalarını tekrar dene.
const deliveryTimer = setInterval(() => { chain = chain.then(() => deliverNotifications(sb)).catch(() => {}); }, 30_000);
for (const signal of ['SIGTERM','SIGINT']) process.on(signal, () => {
  stopping = true; clearInterval(heartbeat); clearInterval(deliveryTimer); clearTimeout(retry); socket?.close();
});
