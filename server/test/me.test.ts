import sharp from 'sharp';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startTestApp, type TestApp } from './helpers';

let t: TestApp;
beforeAll(async () => {
  t = await startTestApp();
});
afterAll(async () => {
  await t.close();
});

function png(width = 400, height = 300) {
  return sharp({ create: { width, height, channels: 3, background: '#4f46e5' } })
    .png()
    .toBuffer();
}

describe('onboarding and profile edits', () => {
  it('requires a name and username before using rooms', async () => {
    const cookie = await t.signIn('new@example.com');
    const rooms = await t.http.get('/api/rooms').set('Cookie', cookie).expect(403);
    expect(rooms.body.error.message).toMatch(/profile/);

    const partial = await t.http.patch('/api/me').set('Cookie', cookie).send({ name: 'New' }).expect(400);
    expect(partial.body.error.fields.username).toBeTruthy();

    const done = await t.http
      .patch('/api/me')
      .set('Cookie', cookie)
      .send({ name: 'New Person', username: 'New_Person', bio: 'Rust and coffee' })
      .expect(200);
    expect(done.body.user).toMatchObject({
      name: 'New Person',
      username: 'new_person',
      bio: 'Rust and coffee',
      onboarded: true,
    });
    await t.http.get('/api/rooms').set('Cookie', cookie).expect(200);
  });

  it('validates usernames', async () => {
    const { cookie } = await t.createUser('validator');
    for (const username of ['ab', 'has space', 'dash-es', 'x'.repeat(21)]) {
      const res = await t.http.patch('/api/me').set('Cookie', cookie).send({ username }).expect(400);
      expect(res.body.error.fields.username).toBeTruthy();
    }
  });

  it('keeps usernames unique and reserved names unavailable', async () => {
    await t.createUser('taken');
    const { cookie } = await t.createUser('other');
    const res = await t.http.patch('/api/me').set('Cookie', cookie).send({ username: 'TAKEN' }).expect(409);
    expect(res.body.error.fields.username).toMatch(/taken/);
    await t.http.patch('/api/me').set('Cookie', cookie).send({ username: 'admin' }).expect(409);
  });

  it('stores an uploaded avatar as a 256px WebP and replaces it', async () => {
    const { cookie } = await t.createUser('pictured');
    const res = await t.http
      .put('/api/me/avatar')
      .set('Cookie', cookie)
      .set('Content-Type', 'image/png')
      .send(await png())
      .expect(200);
    const url: string = res.body.user.avatarUrl;
    expect(url).toMatch(/^\/uploads\/avatars\/[a-f0-9]+-[a-f0-9]{12}\.webp$/);

    const file = await t.http.get(url).expect(200);
    const meta = await sharp(file.body as Buffer).metadata();
    expect(meta).toMatchObject({ format: 'webp', width: 256, height: 256 });

    const replaced = await t.http
      .put('/api/me/avatar')
      .set('Cookie', cookie)
      .set('Content-Type', 'image/png')
      .send(await png(100, 100))
      .expect(200);
    expect(replaced.body.user.avatarUrl).not.toBe(url);
    await t.http.get(url).expect(404);

    const removed = await t.http.delete('/api/me/avatar').set('Cookie', cookie).expect(200);
    expect(removed.body.user.avatarUrl).toBeNull();
  });

  it('rejects files that are not images', async () => {
    const { cookie } = await t.createUser('glitch');
    const res = await t.http
      .put('/api/me/avatar')
      .set('Cookie', cookie)
      .set('Content-Type', 'image/png')
      .send(Buffer.from('definitely not a png'))
      .expect(400);
    expect(res.body.error.message).toMatch(/image/);
    await t.http
      .put('/api/me/avatar')
      .set('Cookie', cookie)
      .set('Content-Type', 'application/octet-stream')
      .send(Buffer.from('x'))
      .expect(415);
  });
});
