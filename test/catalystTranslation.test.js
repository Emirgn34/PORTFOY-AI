import test from 'node:test';
import assert from 'node:assert/strict';
import {catalystEvent,localizeCatalystEvent,ingestCatalyst,ingestCatalystBatch,translateStoredCatalysts} from '../server/catalystNews.js';
import {translateToTurkish} from '../server/marketData.js';
import {notificationBody} from '../server/pushNotifications.js';

const article={id:'vicor-guidance',provider:'Newswire',symbols:['VICR'],title:'Vicor raises third-quarter revenue guidance',url:'https://example.com/vicor',publishedAt:'2026-09-24T18:00:00Z'};
const turkish='Vicor üçüncü çeyrek gelir tahminini yükseltti';

function memoryDb(initial=[]) {
  const rows=new Map(initial.map((row)=>[row.id,structuredClone(row)])), updates=[];
  return {rows,updates,from(table) {
    assert.equal(table,'notification_events');
    const filters=[]; let patch,limit=Infinity,inserted;
    const matches=()=>[...rows.values()].filter((row)=>filters.every((predicate)=>predicate(row))).slice(0,limit);
    return {select(){return this;},order(){return this;},limit(n){limit=n;return this;},
      eq(key,value){filters.push((row)=>row[key]===value);return this;},
      in(key,values){filters.push((row)=>values.includes(row[key]));return this;},
      is(key,value){assert.equal(key,'data->>titleTr');assert.equal(value,null);filters.push((row)=>row.data?.titleTr==null);return this;},
      maybeSingle(){return Promise.resolve({data:matches()[0]??null,error:null});},
      upsert(input){inserted=[];for(const row of Array.isArray(input)?input:[input]){if(!rows.has(row.id)){rows.set(row.id,structuredClone(row));inserted.push(row);}}return this;},
      update(value){patch=value;return this;},
      then(resolve,reject){const selected=matches();if(patch) for(const row of selected){updates.push(patch);rows.set(row.id,{...row,...patch});}return Promise.resolve({data:patch?null:inserted??selected,error:null}).then(resolve,reject);},
    };
  }};
}

test('haber ve push metni Türkçeleşir; özgün başlık ve olay kimliği/zamanları korunur',async()=>{
  const event=catalystEvent(article,new Date('2026-09-24T18:00:02Z'));
  const localized=await localizeCatalystEvent(event,{translate:async(text,options)=>{
    assert.equal(text,article.title);assert.equal(options.timeoutMs,1500);return turkish;
  }});
  assert.equal(localized.body,turkish);assert.equal(localized.data.originalTitle,article.title);
  assert.equal(localized.data.titleTr,turkish);assert.equal(localized.data.translationStatus,'translated');
  assert.equal(notificationBody(localized),turkish);
  for(const key of ['id','detected_at','published_at','expires_at','url']) assert.equal(localized[key],event[key]);
});

test('çeviri kesintisinde Türkçe olay özeti kullanılır; mevcut Türkçe başlık tekrar çevrilmez',async()=>{
  const event=catalystEvent(article);
  const fallback=await localizeCatalystEvent(event,{translate:async()=>{throw new Error('timeout');}});
  assert.equal(fallback.data.translationStatus,'pending');assert.match(fallback.body,/Gelir \/ kâr tahmini yükseldi/);
  assert.notEqual(fallback.body,article.title);
  assert.equal(notificationBody(event),fallback.body); // Henüz güncellenmemiş eski haber de İngilizce push göndermez.
  const cached=await localizeCatalystEvent(event,{titleTr:turkish,translate:async()=>assert.fail('Tekrar çevrilmemeli')});
  assert.equal(cached.body,turkish);
});

test('aynı haber ikinci kez tarandığında çeviri isteği ve olay kaydı yinelenmez',async()=>{
  const db=memoryDb();let calls=0;
  const options={translate:async()=>{calls++;return turkish;}};
  await ingestCatalyst(db,article,options);await ingestCatalyst(db,article,options);
  assert.equal(calls,1);assert.equal(db.rows.size,1);assert.equal([...db.rows.values()][0].body,turkish);
});

test('eski haberler bildirim tarihi ve süresi değiştirilmeden çevrilir; yeniden bildirim üretilmez',async()=>{
  const old=catalystEvent(article,new Date('2026-09-24T18:00:01Z'));delete old.data.originalTitle;
  const db=memoryDb([old]);let calls=0;
  const options={translate:async()=>{calls++;return turkish;}};
  assert.deepEqual(await translateStoredCatalysts(db,options),{checked:1,translated:1,pending:0});
  assert.deepEqual(Object.keys(db.updates[0]).sort(),['body','data']);
  const saved=db.rows.get(old.id);
  assert.equal(saved.data.originalTitle,article.title);assert.equal(saved.detected_at,old.detected_at);assert.equal(saved.expires_at,old.expires_at);
  assert.deepEqual(await translateStoredCatalysts(db,options),{checked:0,translated:0,pending:0});assert.equal(calls,1);
});

test('zaten Türkçe olan çeviri sonucu kabul edilir ve ağ isteği süreyle sınırlanır',async()=>{
  const originalFetch=globalThis.fetch;
  try {
    globalThis.fetch=async(url,options)=>{
      assert.equal(new URL(url).hostname,'translate.googleapis.com');assert.ok(options.signal instanceof AbortSignal);
      return Response.json([[[turkish,turkish,null,null]],null,'tr']);
    };
    assert.equal(await translateToTurkish(turkish),turkish);
  } finally {globalThis.fetch=originalFetch;}
});

test('hızlı kayıtta çeviri beklenmez; Türkçe özet hemen yazılır ve sonraki turda çeviriye uygundur', async () => {
  const event = catalystEvent(article);
  const result = await localizeCatalystEvent(event, { deferTranslation: true,
    translate: async () => assert.fail('Hızlı kayıt çeviri beklememeli') });
  assert.equal(result.data.translationStatus, 'pending');
  assert.equal(result.data.translationAttemptedAt, undefined);
  assert.match(result.body, /VICR: Gelir \/ kâr tahmini yükseldi/);
  const db = memoryDb([result]);
  assert.equal((await translateStoredCatalysts(db, { translate: async () => turkish })).translated, 1);
  assert.equal(db.rows.get(result.id).body, turkish);
  assert.equal(db.rows.get(result.id).detected_at, event.detected_at);
});

test('toplu haber kaydı tekrarları ve önemsiz haberleri eler; mevcut kimlik ve zamanlar değişmez', async () => {
  const db = memoryDb();
  const now = new Date('2026-09-24T18:00:01Z');
  const batch = [article, article, { ...article, id: 'irrelevant', title: 'Vicor announces upcoming investor conference' },
    { ...article, id: 'no-symbol', symbols: [] }];
  assert.deepEqual(await ingestCatalystBatch(db, batch, { now }), { matches: 1, inserted: 1 });
  const saved = structuredClone([...db.rows.values()][0]);
  assert.equal(saved.data.translationStatus, 'pending');
  assert.equal(saved.detected_at, now.toISOString());
  assert.deepEqual(await ingestCatalystBatch(db, batch, { now: new Date('2026-09-24T18:01:00Z') }), { matches: 1, inserted: 0 });
  assert.deepEqual([...db.rows.values()][0], saved);
});

test('çeviri sınırı en yeni başlıklardan yalnızca ayrılan kadarını işler', async () => {
  const events = [1, 2, 3].map((id) => catalystEvent({ ...article, id }));
  const db = memoryDb(events);
  let calls = 0;
  assert.deepEqual(await translateStoredCatalysts(db, { limit: 2, translate: async () => { calls++; return turkish; } }),
    { checked: 2, translated: 2, pending: 0 });
  assert.equal(calls, 2);
  assert.equal([...db.rows.values()].filter((row) => row.data.titleTr).length, 2);
});
