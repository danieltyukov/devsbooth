import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startTestApp, type TestApp } from './helpers';

let t: TestApp;
beforeAll(async () => {
  t = await startTestApp();
});
afterAll(async () => {
  await t.close();
});

describe('profiles and follows', () => {
  it('shows a profile with counts and follow state', async () => {
    const alice = await t.createUser('alice');
    const bob = await t.createUser('bob');

    const before = await t.http.get('/api/users/alice').set('Cookie', bob.cookie).expect(200);
    expect(before.body.profile).toMatchObject({
      username: 'alice',
      followers: 0,
      following: 0,
      isFollowing: false,
      isMe: false,
    });
    expect(before.body.profile).not.toHaveProperty('email');

    const followed = await t.http.put('/api/users/alice/follow').set('Cookie', bob.cookie).expect(200);
    expect(followed.body.profile).toMatchObject({ followers: 1, isFollowing: true });
    // Following twice is a no-op.
    await t.http.put('/api/users/alice/follow').set('Cookie', bob.cookie).expect(200);

    const own = await t.http.get('/api/users/ALICE').set('Cookie', alice.cookie).expect(200);
    expect(own.body.profile).toMatchObject({ followers: 1, isMe: true });
    const bobs = await t.http.get('/api/users/bob').set('Cookie', alice.cookie).expect(200);
    expect(bobs.body.profile.following).toBe(1);

    const unfollowed = await t.http.delete('/api/users/alice/follow').set('Cookie', bob.cookie).expect(200);
    expect(unfollowed.body.profile).toMatchObject({ followers: 0, isFollowing: false });
  });

  it('does not let you follow yourself', async () => {
    const carol = await t.createUser('carol');
    await t.http.put('/api/users/carol/follow').set('Cookie', carol.cookie).expect(400);
  });

  it('returns 404 for unknown users and 401 when signed out', async () => {
    const dave = await t.createUser('dave');
    await t.http.get('/api/users/nobody_here').set('Cookie', dave.cookie).expect(404);
    await t.http.get('/api/users/dave').expect(401);
  });
});
