import importlib.util
import unittest
from datetime import datetime, timezone
from pathlib import Path

import numpy as np
import pandas as pd

spec = importlib.util.spec_from_file_location('hedge_engine', Path(__file__).parents[1]/'scripts'/'hedge_engine.py')
engine = importlib.util.module_from_spec(spec)
spec.loader.exec_module(engine)


class HedgeEngineTests(unittest.TestCase):
    def context(self, closing=False, open_=True):
        return {'market_open':open_, 'run_window':open_, 'closing_window':closing, 'confirmation_tr':'22:45'}

    def qqq(self, **kwargs):
        return {'price':110,'sma50':100,'atr14':5,'weekly_ema20':95,'weekly_ema50':80,
                'volume_ratio':1.2,'change_pct':-1,**kwargs}

    def regime(self, qqq, closing=False, vix=18):
        return engine.select_regime(qqq,{'price':110,'sma50':100},{'price':vix},self.context(closing))[0]

    def test_all_five_regimes_and_precedence(self):
        self.assertEqual(self.regime(self.qqq()),'SAFE')
        self.assertEqual(self.regime(self.qqq(price=101)),'SUPPORT_TEST')
        self.assertEqual(self.regime(self.qqq(price=99)),'TRAP_WARNING')
        self.assertEqual(self.regime(self.qqq(price=97),closing=True),'HEDGE_TRIGGER')
        self.assertEqual(self.regime(self.qqq(price=81)),'DEEP_VALUE_BUY')

    def test_intraday_fakeout_and_volume_and_atr_are_independent(self):
        self.assertEqual(self.regime(self.qqq(price=97)),'TRAP_WARNING')
        self.assertEqual(self.regime(self.qqq(price=99),closing=True),'TRAP_WARNING')
        self.assertEqual(self.regime(self.qqq(price=97,volume_ratio=1.09),closing=True),'TRAP_WARNING')
        self.assertEqual(self.regime(self.qqq(price=97,change_pct=-2.6),vix=22.1),'HEDGE_TRIGGER')
        self.assertEqual(self.regime(self.qqq(price=97,change_pct=-2.5),vix=22.1),'TRAP_WARNING')
        # Weekly20 break is the separately specified structural risk rule.
        self.assertEqual(self.regime(self.qqq(price=94,volume_ratio=.5)),'HEDGE_TRIGGER')

    def test_hedge_notional_math_and_different_benchmarks(self):
        recipe=engine.hedge_recipe(1.55,1.2,1.8,.5,100)
        self.assertAlmostEqual(recipe['sqqq_pct'],25.8333333333)
        self.assertAlmostEqual(recipe['psq_pct'],77.5)
        self.assertAlmostEqual(recipe['soxs_pct'],20)
        self.assertAlmostEqual(recipe['sh_pct'],90)
        self.assertEqual(engine.hedge_recipe(-.2,-.1,-.3,1,100)['sqqq_pct'],0)

    def test_beta_uses_60_common_dates_and_current_weights(self):
        rng=np.random.default_rng(17)
        market=rng.normal(0,.01,60)
        frame=pd.DataFrame({'QQQ':np.r_[100,100*np.cumprod(1+market)],
                            'A':np.r_[100,100*np.cumprod(1+2*market)],
                            'B':np.r_[100,100*np.cumprod(1+market)]})
        self.assertAlmostEqual(engine.weighted_beta(frame,{'A':.6,'B':.4},'QQQ'),1.6)
        frame.loc[35,'A']=np.nan
        with self.assertRaises(engine.DataError): engine.weighted_beta(frame,{'A':.6,'B':.4},'QQQ')

    def test_dst_weekends_holidays_and_early_close(self):
        summer=engine.market_context(datetime(2026,10,23,19,45,tzinfo=timezone.utc))
        winter=engine.market_context(datetime(2026,11,2,20,45,tzinfo=timezone.utc))
        self.assertTrue(summer['closing_window']);self.assertEqual(summer['confirmation_tr'],'22:45')
        self.assertTrue(winter['closing_window']);self.assertEqual(winter['confirmation_tr'],'23:45')
        self.assertFalse(engine.market_context(datetime(2026,10,24,19,45,tzinfo=timezone.utc))['run_window'])
        self.assertFalse(engine.market_context(datetime(2026,12,25,19,45,tzinfo=timezone.utc))['run_window'])
        early=engine.market_context(datetime(2026,11,27,17,45,tzinfo=timezone.utc))
        self.assertTrue(early['closing_window']);self.assertEqual(early['confirmation_tr'],'20:45')

    def test_default_only_for_empty_and_no_silent_us_portfolio_fallback(self):
        holdings,fallback=engine.us_holdings([])
        self.assertTrue(fallback);self.assertEqual(len(holdings),8)
        with self.assertRaises(engine.DataError): engine.us_holdings([{'ticker':'THYAO','market':'BIST','currency':'TRY','quantity':5}])
        holdings,fallback=engine.us_holdings([{'ticker':'NVDA','currency':'USD','quantity':2},
            {'ticker':'NVDA','currency':'USD','quantity':3}])
        self.assertFalse(fallback);self.assertEqual(holdings[0]['quantity'],5)

    def test_atr_wilder_and_missing_monthly100_for_young_stocks(self):
        dates=pd.date_range('2025-01-01',periods=200,freq='B',tz=engine.NY)
        daily=pd.DataFrame({'Close':100.,'High':101.,'Low':99.,'Volume':1000.},index=dates)
        self.assertEqual(engine.atr_wilder(daily),2)
        metrics=engine.indicators(daily,datetime(2026,10,24,tzinfo=timezone.utc))
        self.assertIsNone(metrics['monthly_ema100'])
        self.assertAlmostEqual(metrics['weekly_ema20'],100)

    def test_stale_intraday_prices_fail_closed(self):
        daily=pd.DataFrame({'Close':[100.,101.],'Volume':[1000.,1000.]},
            index=pd.DatetimeIndex(['2026-10-22','2026-10-23'],tz=engine.NY))
        intraday=pd.DataFrame({'Close':[101.],'Volume':[10.]},
            index=pd.DatetimeIndex(['2026-10-23T09:30'],tz=engine.NY))
        context={**self.context(),'session_date':'2026-10-23','last_complete_session':'2026-10-22'}
        with self.assertRaises(engine.DataError):
            engine.quote_from_frames(daily,intraday,datetime(2026,10,23,19,45,tzinfo=timezone.utc),context,'QQQ')

    def test_friday_weekly_ema_includes_only_the_completed_friday(self):
        dates=pd.date_range('2025-01-01','2026-10-23',freq='B',tz=engine.NY)
        daily=pd.DataFrame({'Close':100.,'High':101.,'Low':99.,'Volume':1000.},index=dates)
        daily.loc[daily.index[-1],['Close','High']]=200
        now=datetime(2026,10,23,20,5,tzinfo=timezone.utc)
        self.assertAlmostEqual(engine.indicators(daily.iloc[:-1],now)['weekly_ema20'],100)
        self.assertGreater(engine.indicators(daily,now)['weekly_ema20'],100)


if __name__=='__main__': unittest.main()
