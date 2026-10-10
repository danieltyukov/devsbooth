import { expect, test } from '@playwright/test';
import { readCode, signIn, signUp, uniqueName } from './helpers';

test('a new visitor signs up, sets up a profile and signs out', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Audio rooms for developers.' })).toBeVisible();
  await page.getByRole('link', { name: 'Sign in with email' }).click();
  await expect(page).toHaveURL(/\/signin$/);

  const username = uniqueName('ada');
  await signUp(page, username, 'Ada Lovelace');
  await expect(page.getByRole('heading', { name: 'Rooms' })).toBeVisible();

  await page.getByRole('link', { name: /Your profile/ }).click();
  await expect(page.getByRole('heading', { name: 'Ada Lovelace' })).toBeVisible();
  await expect(page.getByText(`@${username}`)).toBeVisible();

  await page.getByRole('link', { name: 'Edit profile' }).click();
  await page.getByRole('button', { name: 'Sign out' }).click();
  await expect(page).toHaveURL(/\/$/);

  // Signed-out visitors are sent to sign in, and come back where they were going.
  await page.goto('/rooms');
  await expect(page).toHaveURL(/\/signin\?next=%2Frooms/);
  await signIn(page, `${username}@example.com`);
  await expect(page).toHaveURL(/\/rooms$/);
});

test('a wrong code is refused with a clear message', async ({ page }) => {
  const email = `${uniqueName('typo')}@example.com`;
  await page.goto('/signin');
  const sentAfter = Date.now() - 1_000;
  await page.getByLabel('Email').fill(email);
  await page.getByRole('button', { name: 'Send code' }).click();
  const code = await readCode(email, sentAfter);
  const wrong = code === '00000000' ? '11111111' : '00000000';

  await page.getByLabel('Code').fill(wrong);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByText('That code is not right.')).toBeVisible();

  await page.getByLabel('Code').fill(code);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page).toHaveURL(/\/welcome/);
});

test('usernames must be available', async ({ browser }) => {
  const taken = uniqueName('taken');
  const first = await browser.newContext();
  await signUp(await first.newPage(), taken);

  const second = await browser.newContext();
  const page = await second.newPage();
  await signIn(page, `${uniqueName('other')}@example.com`);
  await page.getByLabel('Name', { exact: true }).fill('Someone Else');
  await page.getByLabel('Username').fill(taken);
  await page.getByRole('button', { name: 'Continue' }).click();
  await expect(page.getByText('That username is taken.')).toBeVisible();
  await expect(page).toHaveURL(/\/welcome/);
});
