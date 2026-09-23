import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
const read=async path=>JSON.parse(await readFile(new URL('../'+path,import.meta.url),'utf8'));
test('Facebook migration keeps historical originals and IDs except the confirmed Qwen duplicate while supplying actual summaries',async()=>{
 const old=await read('data/editions/2026-09-23.json');
 const current=await read('data/facebook/editions/2026-09-23.json');
 const mergedId='facebook-37c1fd2869c8005319380e21';
 assert.deepEqual(current.stories.slice(0,old.stories.length-1).map(s=>s.id),old.stories.filter(s=>s.id!==mergedId).map(s=>s.id));
 for(let i=0;i<old.stories.length;i++){
  const s=current.stories.find(s=>s.id===old.stories[i].id || (old.stories[i].id===mergedId && s.id==='facebook-d60dc5423d50b8078fa380e7'));
  assert.equal(s.original_text,old.stories[i].original_text??old.stories[i].summary);
  assert.notEqual(s.summary.trim(),s.original_text.trim());
  assert.ok(s.summary.length>0);
  for(const source of old.stories[i].sources) assert.ok(s.sources.some(candidate=>JSON.stringify(candidate)===JSON.stringify(source)));
  if(s.image){assert.match(s.image.url,/^https:\/\//);assert.ok(s.image.credit);assert.ok(s.image.alt);}
 }
});
test('configured-source migration preserves historical articles and each index points into its own channel',async()=>{
 const old=await read('data/editions/2026-09-22.json');
 const current=await read('data/chatgpt/editions/2026-09-22.json');
 assert.deepEqual(current.stories.slice(0,old.stories.length),old.stories);
 for(const channel of ['facebook','chatgpt']){
  const index=await read('data/'+channel+'/index.json');
  for(const entry of index.editions){
   assert.equal(entry.path,`data/${channel}/editions/${entry.date}.json`);
   const edition=await read(entry.path);
   assert.equal(edition.stories.length,entry.story_count);
  }
 }
});

test('confirmed Qwen duplicate renders as one story and retains both observed links',async()=>{
 const e=await read('data/facebook/editions/2026-09-23.json');
 const qwen=e.stories.filter(s=>s.title==='Qwen-Image-2.1 本機圖片編修心得');
 assert.equal(qwen.length,1);
 assert.equal(qwen[0].id,'facebook-d60dc5423d50b8078fa380e7');
 assert.equal(qwen[0].sources.length,2);
});
