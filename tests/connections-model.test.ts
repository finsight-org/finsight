import assert from 'node:assert/strict';
import {test} from 'node:test';
import {parseCreateInput,parseRenameInput,parseListInput,parseConnectionId,encodeConnectionCursor,mapConnectionRow} from '../src/connections/model.js';
const ids=new Set(['wealthsimple']),id='11111111-1111-4111-8111-111111111111';
test('labels count code points, trim whitespace, and reject invalid or privileged fields',()=>{
 assert.equal(parseRenameInput({label:'😀'.repeat(100)}).label,'😀'.repeat(100));
 for(const value of [{label:'😀'.repeat(101)},{label:'\0'}, {},{label:1},{label:'a',providerId:'other'},null,[]])assert.throws(()=>parseRenameInput(value),{statusCode:400});
 assert.deepEqual(parseRenameInput({label:'\u00a0\ufeff '}),{label:null});assert.deepEqual(parseRenameInput({label:'  Savings  '}),{label:'Savings'});
 assert.deepEqual(parseCreateInput({providerId:'wealthsimple'},ids),{providerId:'wealthsimple',label:null});
 for(const v of [{providerId:'unknown'},{providerId:'wealthsimple',userId:id},null,[],{providerId:1}])assert.throws(()=>parseCreateInput(v,ids),{statusCode:400});
 assert.equal(parseConnectionId(id),id);assert.throws(()=>parseConnectionId('bad'));
});
test('pagination validates untrusted cursors without losing microseconds',()=>{
 assert.deepEqual(parseListInput({}),{limit:50,after:null});
 for(const limit of ['1','100'])assert.equal(parseListInput({limit}).limit,Number(limit));
 for(const v of [{limit:'0'},{limit:'101'},{limit:'1.5'},{limit:['1','2']},{userId:id},{cursor:'!'}, {cursor:'a'.repeat(513)}])assert.throws(()=>parseListInput(v));
 const c={createdAt:'2026-11-03T12:00:00.123456+00:00',id};
 assert.deepEqual(parseListInput({cursor:encodeConnectionCursor(c)}).after,c);
 for(const obj of [{...c,createdAt:'2026-02-30T00:00:00Z'},{...c,id:'x),user_id.neq.x'},{...c,extra:true}])assert.throws(()=>parseListInput({cursor:Buffer.from(JSON.stringify(obj)).toString('base64url')}));
});
test('database mapping fails closed for malformed or wrong-owner rows',()=>{
 const row={id,user_id:id,provider_id:'historical',label:null,created_at:'2026-11-03T00:00:00Z',updated_at:'2026-11-03T00:00:00Z'};
 assert.deepEqual(mapConnectionRow(row,id),{id,providerId:'historical',label:null,createdAt:row.created_at,updatedAt:row.updated_at});
 for(const v of [null,{}, {...row,user_id:crypto.randomUUID()},{...row,created_at:'private diagnostic'}])assert.throws(()=>mapConnectionRow(v,id),{statusCode:503});
});
