import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { createApplication } from '../src/app.js';

const { httpServer, io } = createApplication();
let origin;

before(async () => {
  await new Promise((resolve) => httpServer.listen(0, '127.0.0.1', resolve));
  origin = `http://127.0.0.1:${httpServer.address().port}`;
});

after(async () => {
  await new Promise((resolve) => io.close(resolve));
});

test('rejects invalid public booking input before database or blockchain access', async () => {
  const response = await fetch(`${origin}/api/bookings`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ fullName: '', phone: '12', serviceRequired: 'x' }),
  });
  assert.equal(response.status, 400);
  assert.match((await response.json()).error, /request ID|Full name|phone|service/i);
});

test('requires a valid administrator session for dashboard operations', async () => {
  const response = await fetch(`${origin}/api/admin/dashboard`);
  assert.equal(response.status, 401);
  assert.match((await response.json()).error, /sign-in/i);
});

test('returns not found for unregistered API routes', async () => {
  const response = await fetch(`${origin}/api/not-a-route`);
  assert.equal(response.status, 404);
});
