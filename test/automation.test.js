import test from 'node:test';
import assert from 'node:assert/strict';
import { assessValuations,buildValuePortfolios,validatePortfolioPreferences } from '../src/utils/valueSelection.js';
import { buildModelPortfolios } from '../src/utils/modelPortfolioCore.js';
import { catalystEvent,classifyCatalyst,parsePressReleaseFeed } from '../server/catalystNews.js';
import { validatePushSubscription } from '../server/pushNotifications.js';
import { parseDataromaHistory,parseDataromaManagers } from '../server/sourcePortfolios.js';
import { assessSourceHistory } from '../src/utils/sourcePortfolioPerformance.js';
import { RESEARCH_SOURCES } from '../src/data/researchSources.js';

function candidate(symbol,peRatio=20) {
  return {symbol,companyName:symbol,market:'NASDAQ',currency:'USD',sector:'Teknoloji',analysisDepth:'deep',currentPrice:100,
    riskLevel:'Düşük',liquidityLevel:'Yüksek',industry:'Semiconductors',priceStructure:{bandLow:96,supports:[{level:96,touches:4}]},
    fundamentals:{peRatio,priceToBook:peRatio/5,profitMarginPct:10,revenueGrowthPct:5,currentRatio:2},
    scoreBreakdown:{fundamentalHealthScore:80,riskAdjustedScore:80,growthScore:80,valuationScore:70,dividendScore:60,liquidityScore:80},
    expectation:{expectedReturnPct:10,expectedPrice:110}};
}
test('ABD kısıtı her profilde BIST hisselerini ve eski BIST taşımasını engeller',() => {
  const us=candidate('USA'), bist={...candidate('TR'),market:'BIST'};
  const portfolios=buildModelPortfolios({longCandidates:[us,bist],shortCandidates:[bist],previousPortfolios:[{slug:'balanced-growth',holdings:[{ticker:'TR',market:'BIST'}]}]});
  assert.ok(portfolios.every((p) => p.holdings.every((h) => h.market==='NASDAQ')));
  assert.ok(portfolios.some((p) => p.holdings.length));
});
test('değer seçimi negatif/eksik çarpanı, eksik büyümeyi ve az sayıda emsali ucuz saymaz',() => {
  const peers=[candidate('CHEAP',10),...['A','B','C','D','E'].map((s) => candidate(s,20))];
  assert.equal(assessValuations(peers)[0].valuation.eligible,true);
  assert.equal(assessValuations(peers.slice(0,4))[0].valuation.eligible,false);
  for (const override of [{peRatio:-1,priceToBook:null},{revenueGrowthPct:null},{profitMarginPct:-2}]) {
    const changed={...peers[0],fundamentals:{...peers[0].fundamentals,...override}};
    assert.equal(assessValuations([changed,...peers.slice(1)])[0].valuation.eligible,false);
  }
});
test('manuel portföyler ayrı kimlik taşır, ekleme/çıkarma kaybolmaz ve toplam 100 olur',() => {
  const rows=['CHEAP','A','B','C','D','E'].map((s) => ({horizon:'long',data:candidate(s,s==='CHEAP'?10:20)}));
  const portfolios=buildValuePortfolios({rows,preferences:{'balanced-growth':{include:['A'],exclude:['CHEAP']}}});
  assert.ok(portfolios.every((p) => p.slug.startsWith('value-')));
  const balanced=portfolios.find((p) => p.profileSlug==='balanced-growth');
  assert.equal(balanced.holdings.find((h) => h.ticker==='A').manual,true);
  assert.equal(balanced.holdings.some((h) => h.ticker==='CHEAP'),false);
  assert.equal(Number((balanced.holdings.reduce((s,h) => s+h.weightPct,0)+balanced.cashWeightPct).toFixed(1)),100);
  assert.throws(() => buildValuePortfolios({rows,preferences:{'balanced-growth':{include:['MISSING']}}}),/alınamadı/);
  assert.throws(() => validatePortfolioPreferences({'balanced-growth':{include:['A'],exclude:['A']}}),/hem/);
  assert.throws(() => validatePortfolioPreferences({'balanced-growth':{include:['THYAO.IS']}}),/ABD/);
});
test('Vicor tipi haberi yakalar; olumsuz, söylenti ve beklenti başlıklarını bildirmez',() => {
  for (const title of ['Vicor raises third-quarter revenue guidance','Vicor şirketin üçüncü çeyrek gelir tahminini yükseltmesinin ardından piyasa sonrası değer kazandı.']) assert.equal(classifyCatalyst(title)?.type,'guidance-raised');
  for (const title of ['Vicor lowers revenue guidance','Vicor could raise revenue guidance','Vicor denies higher revenue forecast','Vicor expected to raise outlook']) assert.equal(classifyCatalyst(title),null);
  const article={id:1,provider:'Benzinga',symbols:['VICR'],title:'Vicor raises revenue guidance',publishedAt:'2026-09-24T16:00:00Z',url:'https://benzinga.com/news/1'};
  const first=catalystEvent(article,new Date('2026-09-24T16:00:10Z'));
  const later=catalystEvent(article,new Date('2026-09-24T16:30:00Z'));
  assert.equal(first.id,later.id);
  assert.equal(first.data.latencySeconds,10);
  assert.ok(Date.parse(later.expires_at)<Date.parse(later.detected_at));
  assert.equal(catalystEvent({...article,publishedAt:'not-a-date'}),null);
  assert.equal(catalystEvent({...article,symbols:['THYAO.IS']}),null);
});
test('push endpoint doğrulaması yerel ağ/yanıltıcı alan adını reddeder',() => {
  const keys={p256dh:'A'.repeat(87),auth:'B'.repeat(22)};
  assert.equal(validatePushSubscription({endpoint:'https://web.push.apple.com/token',keys}).endpoint,'https://web.push.apple.com/token');
  for (const endpoint of ['http://fcm.googleapis.com/a','https://127.0.0.1/a','https://fcm.googleapis.com.evil.test/a','https://web.push.apple.com:444/a']) assert.throws(() => validatePushSubscription({endpoint,keys}));
});
test('ücretsiz RSS başlık, tarih ve ABD hisse kodunu okur; HTML hata sayfasını reddeder',() => {
  const xml='<rss><channel><item><title>Vicor raises revenue outlook</title><guid>event-1</guid><link>https://www.prnewswire.com/news/1</link><pubDate>Thu, 24 Sep 2026 20:00:00 +0000</pubDate><description><![CDATA[<p>Vicor (NASDAQ: VICR) announced results.</p>]]></description></item></channel></rss>';
  const [article]=parsePressReleaseFeed(xml,'PR Newswire');
  assert.deepEqual(article.symbols,['VICR']);
  assert.equal(catalystEvent(article,new Date('2026-09-24T20:00:30Z')).data.latencySeconds,30);
  assert.throws(()=>parsePressReleaseFeed('<html>Service unavailable</html>','source'),/RSS/);
});
test('kaynak parser dönem ağırlıklarını korur; bozuk sayfa uydurma sonuç üretmez',() => {
  const html='<table id="grid"><tr><td class="period">2024 &nbsp; Q2</td><td class="sym"><a>BRK.B</a><div><b>Company Inc.</b><br>98.4% of portfolio</div></td></tr></table>';
  const [report]=parseDataromaHistory(html);
  assert.equal(report.reportDate,'2024-06-30');
  assert.equal(report.availableAt,'2024-08-29T00:00:00.000Z');
  assert.deepEqual(report.holdings,[{symbol:'BRK-B',weightPct:98.4}]);
  assert.throws(() => parseDataromaManagers('<html>blocked</html>'));
  assert.equal(RESEARCH_SOURCES.length,49);
});
test('tarihsel portföy değişimi açıklama öncesine taşınmaz; eksik fiyat sıralanmaz',() => {
  const reports=[{availableAt:'2024-01-01',holdings:[{symbol:'A',weightPct:100}]},{availableAt:'2024-02-01',holdings:[{symbol:'B',weightPct:100}]}];
  const prices={A:[{date:'2024-01-01',adjclose:100},{date:'2024-02-01',adjclose:110}],B:[{date:'2024-01-01',adjclose:1},{date:'2024-02-01',adjclose:100},{date:'2024-03-01',adjclose:120}]};
  const result=assessSourceHistory(reports,prices,{start:'2024-01-01',end:'2024-03-01'});
  assert.equal(result.eligible,true); assert.equal(result.returnPct,32);
  assert.equal(assessSourceHistory(reports,{...prices,B:[]},{start:'2024-01-01',end:'2024-03-01'}).eligible,false);
  assert.equal(assessSourceHistory(reports,prices,{start:'2023-01-01',end:'2024-03-01'}).eligible,false);
  assert.equal(assessSourceHistory([{...reports[0],holdings:[{symbol:'A',weightPct:50}]}],prices,{start:'2024-01-01',end:'2024-02-01'}).eligible,false);
});
