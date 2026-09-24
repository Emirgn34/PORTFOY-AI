import test from 'node:test';
import assert from 'node:assert/strict';

test('hesap API yönlendirmesi JWT sahibini kullanır; sahte kullanıcı ve başka hesabın cihazı kabul edilmez', async () => {
  const keys=['SUPABASE_URL','SUPABASE_SERVICE_ROLE_KEY','VAPID_PUBLIC_KEY','VAPID_PRIVATE_KEY','VAPID_SUBJECT'];
  const previous=Object.fromEntries(keys.map((key)=>[key,process.env[key]]));
  const originalFetch=globalThis.fetch;
  const user='11111111-1111-4111-8111-111111111111', other='22222222-2222-4222-8222-222222222222';
  const calls=[];
  try {
    process.env.SUPABASE_URL='https://example.supabase.co';
    process.env.SUPABASE_SERVICE_ROLE_KEY='test-service-key';
    process.env.VAPID_PUBLIC_KEY='test-public'; process.env.VAPID_PRIVATE_KEY='test-private'; process.env.VAPID_SUBJECT='mailto:test@example.com';
    globalThis.fetch=async (input,init={}) => {
      const url=new URL(input); calls.push({url,init});
      assert.equal(url.origin,'https://example.supabase.co');
      const headers=new Headers(init.headers);
      if(url.pathname==='/auth/v1/user') {
        assert.equal(headers.get('authorization'),'Bearer signed-user-token');
        return Response.json({id:user,email:'test@example.com'});
      }
      if(url.pathname==='/rest/v1/value_portfolio_versions' || url.pathname==='/rest/v1/portfolio_jobs') {
        assert.equal(url.searchParams.get('user_id'),`eq.${user}`);
        return Response.json([]);
      }
      if(url.pathname==='/rest/v1/rpc/request_value_portfolios') {
        assert.equal(JSON.parse(init.body).p_user_id,user);
        return Response.json('33333333-3333-4333-8333-333333333333');
      }
      if(url.pathname==='/rest/v1/push_subscriptions') {
        assert.ok(!init.method || init.method==='GET'); // Başka hesabın aboneliğine yazılmaz.
        if(url.searchParams.has('user_id')) assert.equal(url.searchParams.get('user_id'),`eq.${user}`);
        return Response.json({id:'subscription',user_id:other});
      }
      throw new Error(`Beklenmeyen istek: ${url.pathname}`);
    };
    const {default:handler}=await import('../api/account.js');
    async function request(method,query,body,authenticated=true) {
      const res={statusCode:200,setHeader(){},status(code){this.statusCode=code;return this;},json(value){this.body=value;return this;}};
      await handler({method,query,body,headers:authenticated?{authorization:'Bearer signed-user-token'}:{}},res);
      return res;
    }
    assert.equal((await request('GET',{})).statusCode,405);
    assert.equal((await request('GET',{feature:'automation',action:'value'},undefined,false)).statusCode,401);
    assert.equal(calls.length,0);
    const read=await request('GET',{feature:'automation',action:'value',user_id:other});
    assert.equal(read.statusCode,200); assert.deepEqual(read.body.versions,[]);
    const queued=await request('POST',{feature:'automation',action:'value'},{user_id:other,preferences:{}});
    assert.equal(queued.statusCode,202);
    const conflict=await request('POST',{feature:'automation',action:'push'},{topics:['catalyst'],subscription:{endpoint:'https://web.push.apple.com/test',keys:{p256dh:'A'.repeat(87),auth:'B'.repeat(22)}}});
    assert.equal(conflict.statusCode,409);
    const otherDevice=await request('POST',{feature:'automation',action:'push-test'},{endpoint:'https://web.push.apple.com/test',user_id:other});
    assert.equal(otherDevice.statusCode,400); // Geçici test gönderim ucu kaldırıldı.
  } finally {
    globalThis.fetch=originalFetch;
    for(const key of keys) { if(previous[key]===undefined) delete process.env[key]; else process.env[key]=previous[key]; }
  }
});
