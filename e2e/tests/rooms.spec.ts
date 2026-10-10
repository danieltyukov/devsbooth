import { expect, test } from '@playwright/test';
import { createRoom, person, tile } from './helpers';

test('open rooms are listed with a live count and can be searched', async ({ browser }) => {
  const host = await person(browser, 'host');
  const guest = await person(browser, 'guest');
  const topic = `Rust error handling ${host.username}`;
  await createRoom(host.page, topic);
  await expect(tile(host.page, host.username)).toHaveAttribute('data-role', 'speaker');

  await guest.page.goto('/rooms');
  const row = guest.page.getByRole('listitem').filter({ hasText: topic });
  await expect(row).toContainText('1 in the room');
  await expect(row).toContainText('Open');

  await guest.page.getByPlaceholder('Search topics').fill(host.username);
  await expect(guest.page.getByRole('listitem')).toHaveCount(1);
  await guest.page.getByPlaceholder('Search topics').fill(`${host.username} nothing like this`);
  await expect(guest.page.getByText(/No rooms match/)).toBeVisible();

  await guest.page.getByPlaceholder('Search topics').fill('');
  await row.getByRole('link', { name: topic }).click();
  await expect(guest.page.getByRole('heading', { level: 1, name: topic })).toBeVisible();
  await expect(tile(guest.page, guest.username)).toHaveAttribute('data-role', 'listener');
});

test('private rooms are unlisted but open by link', async ({ browser }) => {
  const host = await person(browser, 'secret');
  const guest = await person(browser, 'insider');
  const topic = `Private retro ${host.username}`;
  const url = await createRoom(host.page, topic, 'Private');
  await expect(host.page.getByText('Private room')).toBeVisible();

  await guest.page.goto('/rooms');
  await expect(guest.page.getByRole('heading', { name: 'Rooms' })).toBeVisible();
  await expect(guest.page.getByText(topic)).toHaveCount(0);

  await guest.page.goto(url);
  await expect(guest.page.getByRole('heading', { level: 1, name: topic })).toBeVisible();
});

test('follower rooms are for followers of the host', async ({ browser }) => {
  const host = await person(browser, 'social');
  const fan = await person(browser, 'fan');
  const topic = `Followers hangout ${host.username}`;
  const url = await createRoom(host.page, topic, 'Followers');

  await fan.page.goto(url);
  await expect(fan.page.getByRole('heading', { name: 'This room is for followers' })).toBeVisible();

  await fan.page.goto(`/u/${host.username}`);
  await fan.page.getByRole('button', { name: 'Follow' }).click();
  await expect(fan.page.getByRole('button', { name: 'Unfollow' })).toBeVisible();
  await expect(fan.page.getByText('1 follower')).toBeVisible();

  await fan.page.goto('/rooms');
  await expect(fan.page.getByRole('link', { name: topic })).toBeVisible();
  await fan.page.goto(url);
  await expect(fan.page.getByRole('heading', { level: 1, name: topic })).toBeVisible();
});

test('unknown room links explain themselves', async ({ browser }) => {
  const visitor = await person(browser, 'lost');
  await visitor.page.goto('/r/doesnotexist');
  await expect(visitor.page.getByRole('heading', { name: 'This room has ended' })).toBeVisible();
  await visitor.page.getByRole('link', { name: 'Back to rooms' }).click();
  await expect(visitor.page).toHaveURL(/\/rooms$/);
});
