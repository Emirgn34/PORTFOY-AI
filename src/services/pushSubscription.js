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
