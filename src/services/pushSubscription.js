export function decodePushKey(value) {
  const base64 = value.replace(/-/g, '+').replace(/_/g, '/');
  return Uint8Array.from(atob(base64.padEnd(Math.ceil(base64.length / 4) * 4, '=')), (c) => c.charCodeAt(0));
}

export function subscriptionNeedsRenewal(subscription, publicKey, now = Date.now()) {
  if (!subscription) return false;
  if (subscription.expirationTime != null && subscription.expirationTime <= now) return true;
  const current = subscription.options?.applicationServerKey;
  if (!current) return false;
  const actual = ArrayBuffer.isView(current)
    ? new Uint8Array(current.buffer, current.byteOffset, current.byteLength) : new Uint8Array(current);
  const expected = decodePushKey(publicKey);
  return actual.length !== expected.length || actual.some((byte, index) => byte !== expected[index]);
}

/**
 * Push abonelik akışının TEK gerçeği: izin → SW kaydı → (gerekiyorsa VAPID
 * yenilemesi) → abonelik. Hem bildirim ayarları hem Portföy Kalkanı bunu
 * çağırır; akış bir daha KOPYALANMAMALI — kalkanın VAPID yenilemesini
 * atlaması (sessiz bildirim arızası) tam olarak bu akışın kopyalanmasından
 * doğmuştu (11 Kas 2026 incelemesi, madde 5 ve 13).
 *
 * İzin isteği fonksiyonun İLK işlemidir: iOS, isteğin kullanıcı tıklamasından
 * kesintisiz gelmesini şart koşar — bu çağrının önüne await KOYMAYIN.
 *
 * Sunucuya kaydetme çağıranın işidir (iki akış farklı API uçları kullanır).
 * Kayıt başarısız olursa `created` true iken subscription.unsubscribe()
 * çağrılarak tarayıcıda yetim abonelik bırakılmamalıdır.
 */
export async function getOrCreatePushSubscription(publicKey) {
  const permission = await Notification.requestPermission();
  if (permission !== 'granted') {
    throw new Error('Bildirim izni verilmedi. Site ayarlarından etkinleştirebilirsiniz.');
  }
  const registration = await navigator.serviceWorker.register('/sw.js');
  await navigator.serviceWorker.ready;
  let existing = await registration.pushManager.getSubscription();
  let renewed = false;
  if (subscriptionNeedsRenewal(existing, publicKey)) {
    await existing.unsubscribe();
    existing = null;
    renewed = true;
  }
  const subscription =
    existing ??
    (await registration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: decodePushKey(publicKey),
    }));
  return { subscription, created: !existing, renewed };
}
