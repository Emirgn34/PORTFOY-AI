"""Portfolio Shield: daily/weekly support, confirmed breaks and indicative hedges.

No broker integration and no orders. Running without --apply is read-only.
"""
from __future__ import annotations

import argparse
import concurrent.futures
import json
import math
import os
import re
import sys
import time
import uuid
from datetime import datetime, timedelta, timezone
from pathlib import Path
from zoneinfo import ZoneInfo

import numpy as np
import pandas as pd
import requests
import exchange_calendars as xcals

UTC = timezone.utc
NY = ZoneInfo('America/New_York')
TR = ZoneInfo('Europe/Istanbul')
DEFAULT_SYMBOLS = ['NVDA', 'AMD', 'TSM', 'AVGO', 'RKLB', 'ASTS', 'ORCL', 'PLTR']
CHIPS = {'NVDA', 'AMD', 'TSM', 'AVGO', 'MU', 'ARM', 'INTC', 'QCOM', 'ASML', 'ADI', 'MPWR'}
REGIMES = {'SAFE', 'SUPPORT_TEST', 'TRAP_WARNING', 'HEDGE_TRIGGER', 'DEEP_VALUE_BUY'}


class DataError(RuntimeError):
    pass


def retry(fn, attempts=3):
    for attempt in range(attempts):
        try:
            return fn()
        except Exception:
            if attempt == attempts - 1:
                raise
            time.sleep(2 ** attempt)


def number(value):
    result = float(value)
    if not math.isfinite(result):
        raise DataError('Sonlu olmayan finansal veri.')
    return result


def utc_iso(value):
    return pd.Timestamp(value).tz_convert('UTC').isoformat()


def market_context(now):
    calendar = xcals.get_calendar('XNYS')
    local_date = pd.Timestamp(now.astimezone(NY).date())
    session = calendar.date_to_session(local_date, direction='previous')
    opening = calendar.session_open(session).to_pydatetime()
    closing = calendar.session_close(session).to_pydatetime()
    today = session.date() == local_date.date()
    active = today and opening <= now <= closing + timedelta(minutes=5)
    last_session = session if now >= closing else calendar.previous_session(session)
    if not today:
        last_session = session
    return {
        'session_date': str(session.date()), 'last_complete_session': str(last_session.date()),
        'market_open': today and opening <= now < closing,
        'run_window': active, 'closing_window': active and now >= closing - timedelta(minutes=30),
        'market_close': closing.isoformat(),
        'close_window_tr': f"{(closing-timedelta(minutes=30)).astimezone(TR):%H:%M}–{closing.astimezone(TR):%H:%M}",
        'confirmation_tr': f"{(closing-timedelta(minutes=15)).astimezone(TR):%H:%M}",
    }


def us_holdings(stocks):
    if not isinstance(stocks, list):
        raise DataError('Portföy stocks alanı dizi olmalı.')
    if not stocks:
        return [{'ticker': s, 'quantity': 1} for s in DEFAULT_SYMBOLS], True
    positions = {}
    for stock in stocks:
        if stock.get('currency') != 'USD' or str(stock.get('market', '')).upper() == 'BIST':
            continue
        symbol = str(stock.get('ticker', '')).strip().upper()
        if not re.fullmatch(r'[A-Z][A-Z0-9.-]{0,14}', symbol) or symbol.endswith('.IS'):
            raise DataError('ABD hisse kodu geçersiz.')
        quantity = number(stock.get('quantity', 0))
        if quantity < 0:
            raise DataError('Bu sürüm yalnızca uzun spot pozisyonların betasını hesaplar.')
        if quantity:
            positions[symbol] = positions.get(symbol, 0) + quantity
    if not positions:
        raise DataError('Portföy boş değil ancak hesaplanabilecek uzun USD hissesi yok.')
    if len(positions) > 100:
        raise DataError('Radar bir çalışmada en fazla 100 ABD hissesini destekler.')
    return [{'ticker': key, 'quantity': value} for key, value in positions.items()], False


def normalized_frame(frame):
    if frame is None or frame.empty:
        raise DataError('Piyasa verisi boş.')
    data = frame.copy()
    data.index = pd.DatetimeIndex(data.index)
    if data.index.tz is None:
        data.index = data.index.tz_localize(NY)
    data.index = data.index.tz_convert(NY)
    data = data[~data.index.duplicated(keep='last')].sort_index()
    if (data['Close'].dropna() <= 0).any():
        raise DataError('Sıfır veya negatif fiyat alındı.')
    return data


def completed_daily(frame, now, context):
    data = normalized_frame(frame)
    # Beta and baseline indicators never use an unfinished daily candle.
    cutoff = pd.Timestamp(context['last_complete_session']).date()
    return data[[date <= cutoff for date in data.index.date]].dropna(subset=['Close'])


def atr_wilder(frame, period=14):
    previous = frame['Close'].shift(1)
    tr = pd.concat([frame['High']-frame['Low'], (frame['High']-previous).abs(),
                    (frame['Low']-previous).abs()], axis=1).max(axis=1).dropna()
    if len(tr) < period:
        raise DataError('ATR için yeterli geçmiş yok.')
    atr = number(tr.iloc[:period].mean())
    for value in tr.iloc[period:]:
        atr = ((period-1)*atr + number(value))/period
    return atr


def ema_or_none(series, span):
    series = series.dropna()
    return number(series.ewm(span=span, adjust=False, min_periods=span).mean().iloc[-1]) if len(series) >= span else None


def indicators(daily, now):
    if len(daily) < 61:
        raise DataError('En az 61 tamamlanmış günlük fiyat gerekli.')
    closes = daily['Close']
    # Only completed calendar weeks/months; a young listing has no EMA100M.
    weekly = closes.resample('W-FRI').last()
    current = now.astimezone(NY).date()
    weekly = weekly[[date < current or (date == current and daily.index[-1].date() == current)
                     for date in weekly.index.date]]
    monthly = closes.resample('ME').last()
    month_start = pd.Timestamp(current.replace(day=1), tz=NY)
    monthly = monthly[monthly.index < month_start]
    return {'sma50': number(closes.tail(50).mean()), 'atr14': atr_wilder(daily),
            'volume_avg20': number(daily['Volume'].tail(20).mean()),
            'weekly_ema20': ema_or_none(weekly, 20), 'weekly_ema50': ema_or_none(weekly, 50),
            'monthly_ema100': ema_or_none(monthly, 100)}


def weighted_beta(closes, weights, benchmark, sessions=60):
    returns = closes.pct_change(fill_method=None)
    market = returns[benchmark].dropna().tail(sessions)
    if len(market) != sessions:
        raise DataError(f'{benchmark}: 60 tamamlanmış getiri günü bulunamadı.')
    aligned = returns.reindex(market.index)
    if aligned[list(weights)].isna().any().any():
        raise DataError('Beta için portföy hisselerinin 60 ortak işlem günü eksik; ağırlıklar değiştirilmedi.')
    if not math.isclose(sum(weights.values()), 1, abs_tol=1e-6):
        raise DataError('Beta ağırlıkları toplamı 1 olmalı.')
    variance = number(market.var(ddof=1))
    if variance <= 1e-12:
        raise DataError('Endeks varyansı beta hesaplamak için yetersiz.')
    portfolio_returns = aligned[list(weights)].mul(pd.Series(weights), axis=1).sum(axis=1)
    return number(portfolio_returns.cov(market)/variance)


def select_regime(qqq, soxx, vix, context):
    price, sma, atr = qqq['price'], qqq['sma50'], qqq['atr14']
    weekly20, weekly50 = qqq['weekly_ema20'], qqq['weekly_ema50']
    if weekly20 is None or weekly50 is None:
        raise DataError('QQQ haftalık EMA geçmişi eksik.')
    panic = context['market_open'] and vix['price'] > 22 and qqq['change_pct'] < -2.5
    time_ok = context['closing_window'] or panic or not context['run_window']
    atr_ok = price < sma - 0.4*atr
    volume_ok = qqq['volume_ratio'] >= 1.1
    confirmed = time_ok and atr_ok and volume_ok
    weekly_break = price < weekly20
    deep = price <= weekly50*1.015
    # Explicit precedence resolves overlapping conditions near support.
    if deep:
        regime, ratio = 'DEEP_VALUE_BUY', 0
        action = ('Haftalık EMA50 ana destek bölgesi. Mevcut hedge pozisyonlarını ve kâr/zararını kontrol et; '
                  'hedge azaltımı ve güçlü spot hisselere kademeli ekleme değerlendir. Bu seviye dip garantisi değildir.')
    elif confirmed or weekly_break:
        regime = 'HEDGE_TRIGGER'
        ratio = 1 if weekly_break or soxx['price'] < soxx['sma50'] else 0.5
        action = ('Haftalık EMA20 aşağısında risk artışı.' if weekly_break else 'SMA50 kırılımı zaman, ATR ve hacim filtresini geçti.')
        action += f' %{int(ratio*100)} nominal koruma senaryosunu incele. Stop: QQQ SMA50 üstü günlük kapanış.'
    elif price < sma:
        regime, ratio = 'TRAP_WARNING', 0
        action = f"SMA50 altı sarkma henüz doğrulanmadı; ayı tuzağı olabilir. Panik kararı yerine {context['confirmation_tr']} kapanış kontrolünü bekle."
    elif 0 <= (price/sma-1)*100 <= 1.2:
        regime, ratio = 'SUPPORT_TEST', 0
        action = (f"QQQ SMA50 desteğinde. Kademeli tepki alımı senaryosunu izle; aşağı kırılımda "
                  f"{context['confirmation_tr']} zaman, ATR ve hacim onayını kontrol et.")
    else:
        regime, ratio = 'SAFE', 0
        action = 'Trend güvenli: QQQ günlük SMA50 ve haftalık EMA20 üstünde. Spot pozisyonları izle ve koru.'
    if not context['run_window']:
        action = 'Piyasa kapalı; son tamamlanan seansın görünümü. ' + action
    return regime, ratio, action, {'time_confirmed': time_ok, 'atr_confirmed': atr_ok,
        'volume_confirmed': volume_ok, 'panic': panic, 'weekly_break': weekly_break,
        'break_level': sma-0.4*atr, 'volume_ratio': qqq['volume_ratio']}


def hedge_recipe(beta, soxx_beta, spy_beta, ratio, stop):
    # Alternatives, never additive: QQQ beta cannot size an S&P/sector hedge.
    return {'sqqq_pct': max(0, beta)*ratio/3*100,
            'soxs_pct': max(0, soxx_beta)*ratio/3*100,
            'psq_pct': max(0, beta)*ratio*100, 'sh_pct': max(0, spy_beta)*ratio*100,
            'hedge_ratio': ratio, 'stop_level': stop, 'soxx_beta': soxx_beta, 'spy_beta': spy_beta,
            'alternatives': True, 'method': 'weighted-60-session-covariance-v1',
            'note': 'Her satır ayrı senaryodur. SOXS için SOXX beta vekili kullanılır; ETF baz farkı vardır. Günlük kaldıraç, çok günlük koruma garantisi vermez.'}


def fetch_symbol(symbol):
    import yfinance as yf
    ticker = yf.Ticker(symbol)
    daily = retry(lambda: ticker.history(period='10y', interval='1d', auto_adjust=True, actions=False, raise_errors=True))
    intraday = retry(lambda: ticker.history(period='5d', interval='5m', auto_adjust=True, prepost=False, actions=False, raise_errors=True))
    return normalized_frame(daily), normalized_frame(intraday)


def quote_from_frames(daily, intraday, now, context, symbol):
    expected = context['session_date'] if context['run_window'] else context['last_complete_session']
    today = intraday[[str(date) == expected and stamp.to_pydatetime() <= now
                      for date, stamp in zip(intraday.index.date, intraday.index)]]
    if today.empty:
        raise DataError(f'{symbol}: beklenen seansın fiyatı bulunamadı ({expected}).')
    point_time = today.index[-1].to_pydatetime()
    if context['market_open'] and now-point_time > timedelta(minutes=25):
        raise DataError(f'{symbol}: gün içi veri 25 dakikadan eski. Yeni sinyal üretilmedi.')
    if context['run_window'] and not context['market_open'] and context.get('market_close') and \
            datetime.fromisoformat(context['market_close'])-point_time > timedelta(minutes=25):
        raise DataError(f'{symbol}: kapanışa yakın fiyat yok; eski mumla teyit üretilmedi.')
    previous = daily[[str(date) < expected for date in daily.index.date]]['Close']
    if previous.empty:
        raise DataError(f'{symbol}: önceki kapanış eksik.')
    price = number(today['Close'].iloc[-1])
    day_rows = daily[[str(date) == expected for date in daily.index.date]]
    volume = number(day_rows['Volume'].iloc[-1]) if not day_rows.empty else number(today['Volume'].sum())
    return {'price': price, 'change_pct': (price/number(previous.iloc[-1])-1)*100,
            'volume': volume, 'as_of': point_time.isoformat()}


def analyze(stocks, now, context, fetcher=fetch_symbol):
    holdings, fallback = us_holdings(stocks)
    symbols = sorted(set(['QQQ', 'SOXX', 'SPY', '^VIX']+[h['ticker'] for h in holdings]))
    with concurrent.futures.ThreadPoolExecutor(max_workers=4) as pool:
        frames = dict(zip(symbols, pool.map(fetcher, symbols)))
    quotes, metrics, closes = {}, {}, {}
    for symbol, (daily, intraday) in frames.items():
        quotes[symbol] = quote_from_frames(daily, intraday, now, context, symbol)
        completed = completed_daily(daily, now, context)
        closes[symbol] = pd.Series(completed['Close'].to_numpy(), index=pd.to_datetime(completed.index.date))
        if symbol != '^VIX':
            metrics[symbol] = indicators(completed, now)
    values = {h['ticker']: (1 if fallback else h['quantity']*quotes[h['ticker']]['price']) for h in holdings}
    total = sum(values.values())
    weights = {symbol: value/total for symbol, value in values.items()}
    returns_frame = pd.DataFrame(closes)
    beta = weighted_beta(returns_frame, weights, 'QQQ')
    soxx_beta = weighted_beta(returns_frame, weights, 'SOXX')
    spy_beta = weighted_beta(returns_frame, weights, 'SPY')
    qqq, soxx = {**metrics['QQQ'], **quotes['QQQ']}, {**metrics['SOXX'], **quotes['SOXX']}
    if qqq['volume_avg20'] <= 0:
        raise DataError('QQQ 20 günlük hacim ortalaması geçersiz.')
    qqq['volume_ratio'] = qqq['volume']/qqq['volume_avg20']
    regime, ratio, action, filters = select_regime(qqq, soxx, quotes['^VIX'], context)
    radar = []
    for holding in holdings:
        symbol = holding['ticker']
        m, quote = metrics[symbol], quotes[symbol]
        distance = lambda level: (quote['price']/level-1)*100 if level else None
        status = 'BELOW_SUPPORT' if quote['price'] < m['sma50'] else 'SUPPORT_TEST' if distance(m['sma50']) <= 1.2 else 'ABOVE_SUPPORT'
        note = ('Uzay hissesi: yüksek oynaklık; kademeli risk yönetimi.' if symbol in ['RKLB', 'ASTS'] else
                'Çip hissesi: SOXX sektör teyidini birlikte izle.' if symbol in CHIPS else 'QQQ trendiyle birlikte izle.')
        if m['monthly_ema100'] is None:
            note += ' 100 tamamlanmış aylık mum yok; aylık EMA100 hesaplanmadı.'
        radar.append({'ticker': symbol, 'price': quote['price'], 'weight_pct': weights[symbol]*100,
            'sma50': m['sma50'], 'weekly_ema20': m['weekly_ema20'], 'monthly_ema100': m['monthly_ema100'],
            'sma50_distance_pct': distance(m['sma50']), 'weekly_ema20_distance_pct': distance(m['weekly_ema20']),
            'monthly_ema100_distance_pct': distance(m['monthly_ema100']), 'status': status, 'note': note})
    return {'updated_at': now.isoformat(), 'market_regime': regime,
        'qqq_price': qqq['price'], 'qqq_sma50': qqq['sma50'], 'qqq_atr': qqq['atr14'],
        'qqq_weekly_ema20': qqq['weekly_ema20'], 'qqq_weekly_ema50': qqq['weekly_ema50'],
        'soxx_price': soxx['price'], 'soxx_sma50': soxx['sma50'],
        'soxx_weekly_ema20': soxx['weekly_ema20'], 'soxx_weekly_ema50': soxx['weekly_ema50'],
        'vix_level': quotes['^VIX']['price'], 'vix_change_pct': quotes['^VIX']['change_pct'],
        'portfolio_beta': beta, 'portfolio_value_usd': None if fallback else total,
        'recommended_action': action, 'hedge_recipe': hedge_recipe(beta, soxx_beta, spy_beta, ratio, qqq['sma50']),
        'stock_radar': radar, 'diagnostics': {**context, **filters, 'fallback_portfolio': fallback,
            'notifications_allowed': context['run_window'], 'as_of': quotes['QQQ']['as_of'],
            'price_source': 'Yahoo Finance / yfinance (gecikmeli olabilir)',
            'beta_sessions': 60, 'weighting': 'equal-default-watchlist' if fallback else 'current-usd-position-value',
            'baseline_method': 'completed-daily-weekly-monthly-bars', 'volume_avg20': qqq['volume_avg20']}}


class SupabaseRest:
    def __init__(self):
        self.url = os.environ['SUPABASE_URL'].rstrip('/')
        key = os.environ['SUPABASE_SERVICE_ROLE_KEY']
        self.session = requests.Session()
        self.session.headers.update({'apikey': key, 'Authorization': f'Bearer {key}', 'Content-Type': 'application/json'})

    def call(self, path, payload=None, method=None):
        def send():
            response = self.session.request(method or ('POST' if payload is not None else 'GET'),
                f'{self.url}/rest/v1/{path}', json=payload, timeout=30)
            if not response.ok:
                raise DataError(f'Supabase isteği başarısız ({response.status_code}); tablo ve yetkileri kontrol edin.')
            return response.json() if response.content else None
        return retry(send)


def trigger_notifications(check_only=False):
    app = os.environ['HEDGE_APP_URL'].rstrip('/')
    if not app.startswith('https://'):
        raise DataError('HEDGE_APP_URL HTTPS olmalı.')
    secret = os.environ['CRON_SECRET']
    def send():
        response = requests.post(f'{app}/api/notifications/trigger', headers={'x-cron-secret': secret},
                                 json={'checkOnly': True} if check_only else {}, timeout=60, allow_redirects=False)
        if not response.ok:
            raise DataError(f'Bildirim tetiklenemedi ({response.status_code}); bekleyen olay korunuyor.')
        return response.json()
    return retry(send)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--apply', action='store_true')
    parser.add_argument('--check-api', action='store_true', help='Bildirim göndermeden canlı API yapılandırmasını doğrula.')
    parser.add_argument('--manual', action='store_true', help='Seans dışında son kapanışı analiz et; bildirim gönderme.')
    parser.add_argument('--portfolio-file', type=Path, help='Salt okunur doğrulama için stocks JSON dizisi.')
    args = parser.parse_args()
    if args.check_api:
        print(json.dumps({'api_check': trigger_notifications(check_only=True)}))
        return
    if args.apply and args.portfolio_file:
        raise DataError('Dosya portföyü canlı veritabanına yazılamaz.')
    now = datetime.now(UTC)
    context = market_context(now)
    if not context['run_window'] and not args.manual:
        print(json.dumps({'skipped': True, 'reason': 'ABD seansı kapalı.', **context}))
        return
    sb, version = None, 0
    if args.apply:
        owner = str(uuid.UUID(os.environ['HEDGE_RADAR_USER_ID']))
        sb = SupabaseRest()
        saved = sb.call('hedge_radar_state?id=eq.1&select=owner_user_id,refresh_version,pending_notification')
        if saved and saved[0]['owner_user_id'] != owner:
            raise DataError('Radar başka hesaba bağlı; kullanıcılar birleştirilmedi.')
        version = saved[0]['refresh_version'] if saved else 0
        rows = sb.call(f'portfolios?user_id=eq.{owner}&select=stocks&limit=1')
        stocks = rows[0]['stocks'] if rows else []
    else:
        stocks = json.loads(args.portfolio_file.read_text(encoding='utf-8')) if args.portfolio_file else []
    try:
        state = analyze(stocks, now, context)
        if sb:
            state['owner_user_id'] = owner
            published = sb.call('rpc/publish_hedge_radar_state', {'p_state': state, 'p_refresh_version': version})
            print(json.dumps({'published': published, 'regime': state['market_regime'],
                              'beta': state['portfolio_beta'], 'as_of': state['diagnostics']['as_of']}))
            # Deliver any pending state transition; RPCs make retries idempotent.
            if context['run_window']:
                print(json.dumps({'notifications': trigger_notifications()}))
        else:
            print(json.dumps(state, ensure_ascii=False, allow_nan=False, indent=2))
    except Exception:
        if sb:
            sb.call(f'hedge_radar_state?id=eq.1&refresh_version=eq.{version}',
                    {'refresh_status': 'failed', 'refresh_error': 'Analiz tamamlanamadı. Önceki radar korundu; veri ve iş akışı loglarını kontrol edin.'}, method='PATCH')
        raise


if __name__ == '__main__':
    try:
        main()
    except Exception as exc:
        print(f'[hedge-engine] {type(exc).__name__}: {exc}', file=sys.stderr)
        sys.exit(1)
