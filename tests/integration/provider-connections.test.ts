import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createClient } from '@supabase/supabase-js';
import {createLocalFixture} from './supabase-fixture.js';
const table='provider_connections';
test('owners can independently create duplicate-provider and duplicate-label records',async t=>{
 const f=await createLocalFixture(t);
 const r=await f.a.client.from(table).insert([{provider_id:'wealthsimple',label:'Personal'},{provider_id:'wealthsimple',label:'Personal'}]).select();
 assert.equal(r.error,null); assert.equal(r.data!.length,2); assert.equal(new Set(r.data!.map(x=>x.id)).size,2);assert.ok(r.data!.every(x=>x.user_id===f.a.id));
 assert.equal((await f.b.client.from(table).insert({provider_id:'wealthsimple'})).error,null);
 assert.equal((await f.b.client.from(table).select()).data!.length,1);
 const id=r.data![0].id;
 for(const q of [f.b.client.from(table).select().eq('id',id),f.b.client.from(table).update({label:'stolen'}).eq('id',id).select(),f.b.client.from(table).delete().eq('id',id).select()]){const v=await q;assert.equal(v.error,null);assert.deepEqual(v.data,[]);}
 assert.equal((await f.a.client.from(table).select().eq('id',id)).data![0].label,'Personal');
 for(const field of ['id','user_id','provider_id','created_at','updated_at']){
 const value=field==='provider_id'?'other':field.endsWith('_at')?'2020-01-01T00:00:00Z':crypto.randomUUID();
 assert.ok((await f.a.client.from(table).update({[field]:value}).eq('id',id)).error);
 if(field!=='provider_id') assert.ok((await f.a.client.from(table).insert({provider_id:'wealthsimple',[field]:value})).error);
 }
 for(const label of ['',' ','\u00a0\ufeff','😀'.repeat(101)])assert.ok((await f.a.client.from(table).insert({provider_id:'wealthsimple',label})).error);
 assert.equal((await f.a.client.from(table).insert({provider_id:'historical-provider',label:'😀'.repeat(100)})).error,null);
 const anon=createClient(f.config.supabaseUrl,f.config.publishableKey,{auth:{persistSession:false}});
 assert.ok((await anon.from(table).select()).error);
});
