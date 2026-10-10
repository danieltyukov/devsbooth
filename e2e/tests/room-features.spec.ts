import { expect, test } from '@playwright/test';
import { createRoom, person, tile } from './helpers';

test('profiles show the live rooms a person hosts', async ({ browser }) => {
  const host = await person(browser, 'presenter');
  const visitor = await person(browser, 'visitor');
  const open = `Open session ${host.username}`;
  const hidden = `Private session ${host.username}`;
  await createRoom(host.page, hidden, 'Private');
  await createRoom(host.page, open);

  await visitor.page.goto(`/u/${host.username}`);
  const hosting = visitor.page.getByRole('region', { name: 'Hosting now' });
  await expect(hosting.getByRole('link', { name: open })).toBeVisible();
  await expect(hosting.getByText(hidden)).toHaveCount(0);

  await host.page.goto(`/u/${host.username}`);
  const own = host.page.getByRole('region', { name: 'Your open rooms' });
  await expect(own.getByRole('link', { name: hidden })).toBeVisible();
  await expect(own.getByRole('link', { name: open })).toBeVisible();
});

test('the host renames the room and everyone sees it', async ({ browser }) => {
  const host = await person(browser, 'renamer');
  const guest = await person(browser, 'reader');
  const url = await createRoom(host.page, `Before ${host.username}`);
  await guest.page.goto(url);
  await expect(tile(guest.page, guest.username)).toBeVisible();
  await expect(guest.page.getByRole('button', { name: 'Edit topic' })).toHaveCount(0);

  await host.page.getByRole('button', { name: 'Edit topic' }).click();
  await host.page.getByLabel('New topic').fill(`After ${host.username}`);
  await host.page.getByRole('button', { name: 'Save topic' }).click();
  await expect(host.page.getByRole('heading', { level: 1, name: `After ${host.username}` })).toBeVisible();
  await expect(guest.page.getByRole('heading', { level: 1, name: `After ${host.username}` })).toBeVisible();
});

test('typing a new topic does not trigger the M shortcut', async ({ browser }) => {
  const host = await person(browser, 'typist');
  await createRoom(host.page, `Shortcuts ${host.username}`);
  await expect(host.page.getByRole('button', { name: 'Unmute' })).toBeEnabled();
  const hostTile = tile(host.page, host.username);

  await host.page.getByRole('button', { name: 'Edit topic' }).click();
  await host.page.getByLabel('New topic').press('m');
  await expect(host.page.getByLabel('New topic')).toHaveValue(/m$/);
  await expect(hostTile).toHaveAttribute('data-muted', 'true');
});

test('the room link is copied where there is no share sheet', async ({ browser }) => {
  const host = await person(browser, 'sharer');
  await host.context.grantPermissions(['microphone', 'clipboard-read', 'clipboard-write']);
  const url = await createRoom(host.page, `Share ${host.username}`);
  await host.page.getByRole('button', { name: 'Copy link' }).click();
  await expect(host.page.getByRole('button', { name: 'Link copied' })).toBeVisible();
  expect(await host.page.evaluate(() => navigator.clipboard.readText())).toBe(url);
});
