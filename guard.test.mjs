import test from 'node:test';
import assert from 'node:assert/strict';
import { Guard } from './guard.mjs';

test('slow repeated successful requests remain allowed', () => {
  const guard = new Guard({mode:'enforce'});
  for(let i=0;i<150;i++) guard.record('slow', {path:'/checkout', status:200, duration:12000});
  assert.equal(guard.inspect('slow').action, 'allow');
});
test('server errors and timeout retries do not establish malicious intent', () => {
  const guard = new Guard({mode:'enforce'});
  for(let i=0;i<150;i++) guard.record('retry', {path:'/checkout', status:503, duration:20000});
  assert.equal(guard.inspect('retry').action, 'allow');
});
test('legitimate flash crowd sharing an IP is allowed', () => {
  const guard = new Guard({mode:'enforce'});
  for(let i=0;i<1000;i++) guard.record('nat', {path:'/products', status:200});
  assert.equal(guard.inspect('nat').action,'allow');
});
test('observe mode never limits even sustained failed authentication', () => {
  const guard = new Guard();
  for(let i=0;i<50;i++) guard.record('test',{path:'/login',status:401});
  assert.equal(guard.inspect('test').action,'would-rate-limit');
});
test('enforcement expires when the observation window expires', () => {
  let now=0;
  const guard = new Guard({mode:'enforce',clock:()=>now});
  for(let i=0;i<50;i++) guard.record('test',{path:'/login',status:401});
  assert.equal(guard.inspect('test').action,'rate-limit');
  now=61000;
  assert.equal(guard.inspect('test').action,'allow');
});
test('one missing URL retried repeatedly is not scanning', () => {
  const guard = new Guard({mode:'enforce'});
  for(let i=0;i<100;i++) guard.record('retry',{path:'/missing',status:404});
  assert.equal(guard.inspect('retry').action,'allow');
});
test('broad missing-path scan is flagged', () => {
  const guard = new Guard();
  for(let i=0;i<100;i++) guard.record('scan',{path:`/missing-${i}`,status:404});
  assert.equal(guard.inspect('scan').risk,'review');
});
