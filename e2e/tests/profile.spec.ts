import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, test } from '@playwright/test';
import { person } from './helpers';

const fixtures = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../fixtures');

test('people can edit their profile and upload a photo', async ({ browser }) => {
  const me = await person(browser, 'painter');
  await me.page.goto('/settings');
  await me.page.getByLabel('Bio').fill('Shaders, synths and slow coffee.');
  await me.page.getByRole('button', { name: 'Save changes' }).click();
  await expect(me.page.getByText('Profile saved.')).toBeVisible();

  await me.page.locator('#avatar-file').setInputFiles(path.join(fixtures, 'avatar.png'));
  await expect(me.page.getByRole('button', { name: 'Change photo' })).toBeVisible();

  await me.page.goto(`/u/${me.username}`);
  await expect(me.page.getByText('Shaders, synths and slow coffee.')).toBeVisible();
  const photo = me.page.locator('img[src^="/uploads/avatars/"]').first();
  await expect(photo).toBeVisible();
  expect(await photo.evaluate((img: HTMLImageElement) => img.naturalWidth)).toBe(256);
});

test('following someone updates both profiles', async ({ browser }) => {
  const a = await person(browser, 'reader');
  const b = await person(browser, 'writer');
  await a.page.goto(`/u/${b.username}`);
  await a.page.getByRole('button', { name: 'Follow' }).click();
  await expect(a.page.getByText('1 follower')).toBeVisible();

  await b.page.goto(`/u/${a.username}`);
  await expect(b.page.getByText('1 following')).toBeVisible();

  await a.page.getByRole('button', { name: 'Unfollow' }).click();
  await expect(a.page.getByText('0 followers')).toBeVisible();
});

test('unknown profiles show a clear message', async ({ browser }) => {
  const me = await person(browser, 'seeker');
  await me.page.goto('/u/no_such_person_here');
  await expect(me.page.getByRole('heading', { name: 'No one by that name' })).toBeVisible();
});
