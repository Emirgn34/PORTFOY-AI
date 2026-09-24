self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()));
// Özel hesap verileri veya API yanıtları çevrimdışı önbelleğe alınmaz.
self.addEventListener('push', (event) => {
  let data = {};
  try { data = event.data?.json() ?? {}; } catch { data.body = event.data?.text(); }
  event.waitUntil(self.registration.showNotification(data.title || 'PortföyAI', {
    body: data.body || 'Yeni bir gelişme var.', icon: '/logo.png', badge: '/logo.png',
    tag: data.tag || 'portfoyai', data: { url: data.url || '/news?tab=catalysts' },
  }));
});
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  event.waitUntil((async () => {
    let url = new URL('/news?tab=catalysts', self.location.origin);
    try { const target = new URL(event.notification.data?.url, self.location.origin); if (target.origin === self.location.origin) url = target; } catch { /* safe default */ }
    const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const client of windows) {
      if (new URL(client.url).origin === url.origin && 'navigate' in client) { await client.navigate(url.href); return client.focus(); }
    }
    return self.clients.openWindow(url.href);
  })());
});
