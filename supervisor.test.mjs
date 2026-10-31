import test from 'node:test';
import assert from 'node:assert/strict';
import { review } from './supervisor.mjs';
import { Guard } from './guard.mjs';
const proposal={action:'rate-limit',reasons:['Worker claims attack'],confidence:1};
test('supervisor vetoes a confident worker without evidence',()=>{
  assert.equal(review(proposal,[],{mode:'enforce'}).verdict,'veto');
});
test('supervisor vetoes slow successful retries regardless of worker score',()=>{
  const rows=Array.from({length:100},(_,i)=>({at:i*400,status:200,path:'/',duration:12000}));
  assert.equal(review(proposal,rows,{mode:'enforce',now:40000}).action,'allow');
});
test('supervisor vetoes burst-only failed logins',()=>{
  const rows=Array.from({length:100},()=>({at:0,status:401,path:'/login'}));
  assert.equal(review(proposal,rows,{mode:'enforce',now:100}).verdict,'veto');
});
test('supervisor independently corroborates sustained scan evidence',()=>{
  const rows=Array.from({length:100},(_,i)=>({at:i*400,status:404,path:`/missing-${i}`}));
  assert.equal(review(proposal,rows,{mode:'enforce',now:40000}).action,'rate-limit');
  assert.equal(review(proposal,rows,{mode:'observe',now:40000}).action,'would-rate-limit');
});
test('combined pipeline vetoes bursts, abstains on ambiguous logins and recovers',()=>{
  let now=0; const guard=new Guard({mode:'enforce',clock:()=>now});
  for(let i=0;i<50;i++) guard.record('client',{status:401,path:'/login'});
  assert.equal(guard.inspect('client').action,'rate-limit');
  assert.equal(guard.decision('client').action,'allow');
  for(let i=0;i<60;i++){now+=500;guard.record('client',{status:401,path:'/login'});}
  assert.equal(guard.decision('client').action,'allow');
  assert.equal(guard.decision('client').verdict,'needs-additional-evidence');
  now+=61000;
  assert.equal(guard.decision('client').action,'allow');
});
