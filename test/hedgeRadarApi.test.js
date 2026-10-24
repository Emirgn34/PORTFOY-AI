import test from 'node:test';
import assert from 'node:assert/strict';
import {createHedgeRadarHandler,validCronSecret} from '../server/hedgeRadarApi.js';
import webpush from 'web-push';
import {deliverNotifications} from '../server/pushNotifications.js';

function response(){return {statusCode:200,setHeader(){},status(c){this.statusCode=c;return this;},json(v){this.body=v;return this;}};}
const owner='11111111-1111-4111-8111-111111111111';
test('kalkan API: yanlış secret ve oturumsuz istek veri okumaz; kullanıcılar izole edilir',async()=>{
  let dbReads=0,queued=0,sent=0;
  const sb={auth:{getUser:async token=>({data:{user:{id:token==='owner'?owner:'other'}}})},
    rpc:async()=>{queued++;return {data:'hedge-key'};}};
  const handler=createHedgeRadarHandler({getDb:()=>{dbReads++;return sb;},send:async()=>{sent++;return {sent:1};},
    env:{CRON_SECRET:'a'.repeat(40),HEDGE_RADAR_USER_ID:owner}});
  async function call(method,action,headers={}){const res=response();await handler({method,query:{action},headers},res);return res;}
  assert.equal((await call('POST','trigger',{'x-cron-secret':'wrong'})).statusCode,401);
  assert.equal(dbReads,0);
  assert.equal((await call('GET','state')).statusCode,401);
  assert.equal((await call('GET','state',{authorization:'Bearer other'})).statusCode,403);
  assert.equal((await call('POST','refresh',{authorization:'Bearer owner'})).statusCode,503);
  const result=await call('POST','trigger',{'x-cron-secret':'a'.repeat(40)});
  assert.equal(result.statusCode,200);assert.equal(queued,1);assert.equal(sent,1);
  assert.equal(validCronSecret('a'.repeat(40),''),false);
});

test('kalkan yenileme JWT sahibini kullanır, beş dakika sınırını uygular ve GitHub sırlarını gizler',async()=>{
  const calls=[];
  const sb={auth:{getUser:async()=>({data:{user:{id:owner}}})},rpc:async(name,args)=>{
    assert.equal(args.p_user_id,owner);return {data:7};}};
  const handler=createHedgeRadarHandler({getDb:()=>sb,env:{HEDGE_RADAR_USER_ID:owner,HEDGE_GITHUB_TOKEN:'private'},
    fetcher:async(url,options)=>{calls.push({url,options});return {ok:true};}});
  const req={method:'POST',query:{action:'refresh'},headers:{authorization:'Bearer owner'},body:{user_id:'other'}};
  const res=response();await handler(req,res);
  assert.equal(res.statusCode,202);assert.equal(res.body.revision,7);
  assert.equal(calls.length,1);assert.ok(calls[0].url.endsWith('/hedge_radar.yml/dispatches'));
  assert.ok(!JSON.stringify(res.body).includes('private'));
  sb.rpc=async()=>({error:{message:'Yeni analiz için 5 dakika bekleyin.'}});
  const throttled=response();await handler(req,throttled);assert.equal(throttled.statusCode,429);
});

test('canlı kurulum denetimi bildirim üretmez; hesap, VAPID veya manuel analiz ayarı eksikse başarısız olur',async()=>{
  let queued=0,sent=0;
  const sb={rpc:async()=>{queued++;return {data:'event'};},from(){return {
    select(){return this;},eq(){return this;},maybeSingle:async()=>({data:{owner_user_id:owner,updated_at:'2026-10-24',market_regime:'SAFE'}}),
  };}};
  const env={CRON_SECRET:'a'.repeat(40),HEDGE_RADAR_USER_ID:owner,VAPID_PUBLIC_KEY:'public',VAPID_PRIVATE_KEY:'private',
    VAPID_SUBJECT:'mailto:test@example.com',HEDGE_GITHUB_TOKEN:'private-token'};
  const handler=createHedgeRadarHandler({getDb:()=>sb,env,send:async()=>{sent++;return {sent:0};}});
  const req={method:'POST',query:{action:'trigger'},headers:{'x-cron-secret':env.CRON_SECRET},body:{checkOnly:true}};
  let res=response();await handler(req,res);
  assert.equal(res.statusCode,200);assert.equal(res.body.ok,true);assert.equal(queued,0);assert.equal(sent,0);
  delete env.HEDGE_GITHUB_TOKEN;
  res=response();await handler(req,res);
  assert.equal(res.statusCode,503);assert.equal(res.body.checks.manualRefreshConfigured,false);
  assert.equal(queued,0);assert.equal(sent,0);
});

test('kalkan bildirimi yalnız radar sahibinin abone cihazına gider; başka hesap bildirim almaz',async()=>{
  const vapid=webpush.generateVAPIDKeys();
  const old={VAPID_PUBLIC_KEY:process.env.VAPID_PUBLIC_KEY,VAPID_PRIVATE_KEY:process.env.VAPID_PRIVATE_KEY,VAPID_SUBJECT:process.env.VAPID_SUBJECT};
  const originalSend=webpush.sendNotification;const sent=[];let claimed=0;
  try {
    Object.assign(process.env,{VAPID_PUBLIC_KEY:vapid.publicKey,VAPID_PRIVATE_KEY:vapid.privateKey,VAPID_SUBJECT:'mailto:test@example.com'});
    webpush.sendNotification=async subscription=>{sent.push(subscription.endpoint);};
    const event={id:'hedge-test',topic:'hedge-radar',title:'Kalkan',body:'Teyit',url:'/portfolio#hedge-shield',data:{userId:owner},
      detected_at:new Date().toISOString(),expires_at:new Date(Date.now()+60000).toISOString()};
    const subscriptions=[owner,'other'].map((user_id,i)=>({id:`sub${i}`,user_id,topics:['hedge-radar'],created_at:'2020-01-01',
      subscription:{endpoint:`https://web.push.apple.com/${i}`,keys:{p256dh:'A'.repeat(87),auth:'B'.repeat(22)}}}));
    const sb={rpc:async()=>{claimed++;return {data:true};},from(table){return {
      select(){return this;},gt(){return this;},order(){return this;},limit(){return this;},range(){return this;},
      update(){return this;},eq(){return this;},then(resolve){return Promise.resolve(resolve({data:table==='notification_events'?[event]:table==='push_subscriptions'?subscriptions:[]}));}
    };}};
    const result=await deliverNotifications(sb);
    assert.equal(result.sent,1);assert.equal(claimed,1);assert.deepEqual(sent,['https://web.push.apple.com/0']);
  } finally {
    webpush.sendNotification=originalSend;
    for(const [key,value]of Object.entries(old)) {if(value===undefined)delete process.env[key];else process.env[key]=value;}
  }
});
