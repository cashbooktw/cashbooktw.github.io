import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
const read=async path=>JSON.parse(await readFile(new URL('../'+path,import.meta.url),'utf8'));
test('Facebook migration keeps every historical ID and full original while supplying actual summaries',async()=>{
 const old=await read('data/editions/2026-09-23.json');
 const current=await read('data/facebook/editions/2026-09-23.json');
 assert.deepEqual(current.stories.slice(0,old.stories.length).map(s=>s.id),old.stories.map(s=>s.id));
 for(let i=0;i<old.stories.length;i++){
  const s=current.stories[i];
  assert.equal(s.original_text,old.stories[i].original_text??old.stories[i].summary);
  assert.notEqual(s.summary.trim(),s.original_text.trim());
  assert.ok(s.summary.length>0);
  assert.deepEqual(s.sources,old.stories[i].sources);
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
