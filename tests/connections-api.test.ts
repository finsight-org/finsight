import assert from 'node:assert/strict';import{test}from'node:test';import{connectionApiFixture}from'./connections-fixtures.js';
const headers={authorization:'Bearer a'};
test('connection HTTP contract isolates users and retains records for removed providers',async t=>{
 const f=connectionApiFixture();t.after(()=>f.app.close());
 const created=await f.app.inject({method:'POST',url:'/api/connections',headers,payload:{providerId:'library',label:'  Personal  '}});assert.equal(created.statusCode,201);
 const c=created.json().connection;assert.equal(c.label,'Personal');assert.deepEqual(Object.keys(c).sort(),['createdAt','id','label','providerId','updatedAt']);const url=`/api/connections/${c.id}`;assert.equal(created.headers.location,url);
 assert.equal((await f.app.inject({url,headers:{authorization:'Bearer b'}})).statusCode,404);
 assert.equal((await f.app.inject({url,headers})).json().connection.id,c.id);
 const removed=f.withoutProvider();t.after(()=>removed.close());assert.equal((await removed.inject({url,headers})).statusCode,200);
 assert.equal((await removed.inject({method:'POST',url:'/api/connections',headers,payload:{providerId:'library'}})).statusCode,400);
 assert.equal((await removed.inject({method:'PATCH',url,headers,payload:{label:null}})).json().connection.label,null);
 assert.equal((await removed.inject({method:'DELETE',url,headers})).statusCode,204);assert.equal((await removed.inject({method:'DELETE',url,headers})).statusCode,404);assert.equal(f.state.calls,0);
});
test('invalid requests and absent auth never reach storage; preflight remains scoped',async t=>{
 const f=connectionApiFixture();t.after(()=>f.app.close());
 for(const payload of [{providerId:'unknown'},{providerId:'library',userId:'b'},{providerId:'library',label:'\0'}])assert.equal((await f.app.inject({method:'POST',url:'/api/connections',headers,payload})).statusCode,400);
 assert.equal((await f.app.inject('/api/connections')).statusCode,401);assert.equal((await f.app.inject({url:'/api/connections?cursor=!',headers})).statusCode,400);assert.equal(f.calls.length,0);
 const origin='http://127.0.0.1:5173';
 const r=await f.app.inject({method:'OPTIONS',url:'/api/connections',headers:{origin,'access-control-request-method':'POST','access-control-request-headers':'Authorization, Content-Type'}});assert.equal(r.statusCode,204);assert.equal(f.calls.length,0);
 assert.equal((await f.app.inject({method:'HEAD',url:'/api/connections',headers})).statusCode,404);
 for(const [payload,type,status]of [['{','application/json',400],['x'.repeat(16385),'application/json',413],['x','application/unknown',415]]as const){const r=await f.app.inject({method:'POST',url:'/api/connections',headers:{...headers,'content-type':type},payload});assert.equal(r.statusCode,status);assert.equal(typeof r.json().error.code,'string');assert.equal(r.headers['cache-control'],'no-store');}
});

test('invalid record IDs are rejected before creating a store',async t=>{const f=connectionApiFixture();t.after(()=>f.app.close());for(const method of ['GET','DELETE']as const)assert.equal((await f.app.inject({method,url:'/api/connections/not-a-uuid',headers})).statusCode,400);assert.equal(f.calls.length,0);});

test('disconnect during verification prevents later storage work',async t=>{
 const {createApp}=await import('../src/app.js');const {authConfig}=await import('./auth-fixtures.js');const {request}=await import('node:http');
 let release!:()=>void,started!:()=>void,closed!:()=>void;const gate=new Promise<void>(r=>release=r),ready=new Promise<void>(r=>started=r),gone=new Promise<void>(r=>closed=r);let stores=0;
 const app=createApp([],{auth:authConfig,verifyAccessToken:async()=>{started();await gate;return{status:'authenticated',user:{id:'a',email:null}};},createConnectionStore:()=>{stores++;throw new Error('must not start');}});
 app.addHook('onRequest',async(_req,reply)=>{reply.raw.once('close',closed);});t.after(()=>app.close());
 const url=await app.listen({host:'127.0.0.1',port:0});const req=request(`${url}/api/connections`,{headers});req.on('error',()=>{});req.end();await ready;req.destroy();await gone;release();await new Promise(r=>setImmediate(r));assert.equal(stores,0);
});
