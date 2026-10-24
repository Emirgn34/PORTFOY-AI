import { supabase } from './supabaseClient.js';

export type Regime = 'SAFE' | 'SUPPORT_TEST' | 'TRAP_WARNING' | 'HEDGE_TRIGGER' | 'DEEP_VALUE_BUY';
export interface RadarStock {
  ticker: string; price: number; weight_pct: number; sma50: number;
  weekly_ema20: number | null; monthly_ema100: number | null;
  sma50_distance_pct: number; weekly_ema20_distance_pct: number | null;
  monthly_ema100_distance_pct: number | null; status: string; note: string;
}
export interface RadarState {
  updated_at: string | null; market_regime: Regime | null; previous_regime: Regime | null;
  qqq_price: number; qqq_sma50: number; qqq_atr: number; qqq_weekly_ema20: number; qqq_weekly_ema50: number;
  soxx_price: number; soxx_sma50: number; soxx_weekly_ema20: number; soxx_weekly_ema50: number;
  vix_level: number; vix_change_pct: number; portfolio_beta: number; portfolio_value_usd: number | null;
  recommended_action: string; refresh_status: string; refresh_error?: string; refresh_requested_at?: string;
  hedge_recipe: { sqqq_pct: number; soxs_pct: number; psq_pct: number; sh_pct: number;
    hedge_ratio: number; stop_level: number; soxx_beta: number; spy_beta: number; note: string };
  diagnostics: { market_open: boolean; notifications_allowed: boolean; as_of: string; closing_window: boolean;
    confirmation_tr: string; close_window_tr: string; session_date: string; fallback_portfolio: boolean;
    volume_ratio: number; atr_confirmed: boolean; volume_confirmed: boolean; time_confirmed: boolean; panic: boolean;
    price_source: string };
  stock_radar: RadarStock[];
}

export async function hedgeRequest<T>(path = '', method = 'GET', body?: unknown): Promise<T> {
  const session = supabase ? (await supabase.auth.getSession()).data.session : null;
  if (!session) throw new Error('Portföy Kalkanı için hesabınıza giriş yapın.');
  const response = await fetch(path.startsWith('/api/') ? path : `/api/hedge-radar${path}`, {
    method, headers: {Authorization:`Bearer ${session.access_token}`,'Content-Type':'application/json'},
    ...(body ? {body:JSON.stringify(body)} : {}), signal:AbortSignal.timeout(20000),
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || 'Radar isteği tamamlanamadı.');
  return data;
}

export async function enableShieldNotifications(config: {publicKey: string; subscriptions: {endpoint:string;topics:string[]}[]}) {
  // Permission must be requested synchronously from the button click on iOS.
  const permission = await Notification.requestPermission();
  if (permission !== 'granted') throw new Error('Bildirim izni verilmedi. Site ayarlarından etkinleştirebilirsiniz.');
  const registration = await navigator.serviceWorker.register('/sw.js');
  await navigator.serviceWorker.ready;
  const existing = await registration.pushManager.getSubscription();
  const base64 = config.publicKey.replace(/-/g,'+').replace(/_/g,'/');
  const key = Uint8Array.from(atob(base64.padEnd(Math.ceil(base64.length/4)*4,'=')), c=>c.charCodeAt(0));
  const subscription = existing ?? await registration.pushManager.subscribe({userVisibleOnly:true,applicationServerKey:key});
  const stored = config.subscriptions.find(item=>item.endpoint===subscription.endpoint);
  const topics = [...new Set([...(stored?.topics ?? []),'hedge-radar'])];
  try { await hedgeRequest('/api/notifications/subscribe','POST',{subscription:subscription.toJSON(),topics}); }
  catch (error) { if (!existing) await subscription.unsubscribe(); throw error; }
}
