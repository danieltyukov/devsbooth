import { randomBytes } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, type Browser, type BrowserContext, type Page } from '@playwright/test';

const outbox = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../.cache/outbox');

/** A username unique to this run, so tests can share one server. */
export function uniqueName(prefix: string): string {
  return `${prefix}_${randomBytes(3).toString('hex')}`;
}

/** Waits for the newest sign-in email to `email` and returns its code. */
export async function readCode(email: string, after: number): Promise<string> {
  for (let attempt = 0; attempt < 50; attempt++) {
    const files = await readdir(outbox).catch(() => [] as string[]);
    for (const file of files
      .filter((name) => name.endsWith('.json'))
      .sort()
      .reverse()) {
      const message = JSON.parse(await readFile(path.join(outbox, file), 'utf8')) as {
        to: string;
        text: string;
        sentAt: string;
      };
      if (message.to === email && Date.parse(message.sentAt) >= after) {
        const code = /\b(\d{8})\b/.exec(message.text)?.[1];
        if (code) return code;
      }
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`No sign-in email reached ${email}`);
}

/** Signs in through the UI and returns once the code has been accepted. */
export async function signIn(page: Page, email: string): Promise<void> {
  await page.goto('/signin');
  const sentAfter = Date.now() - 1_000;
  await page.getByLabel('Email').fill(email);
  await page.getByRole('button', { name: 'Send code' }).click();
  await expect(page.getByRole('heading', { name: 'Check your email' })).toBeVisible();
  await page.getByLabel('Code').fill(await readCode(email, sentAfter));
  await page.getByRole('button', { name: 'Sign in' }).click();
}

/** Signs a new user up and finishes onboarding. Lands on the rooms list. */
export async function signUp(page: Page, username: string, name = `${username} Tester`): Promise<void> {
  await signIn(page, `${username}@example.com`);
  await expect(page).toHaveURL(/\/welcome/);
  await page.getByLabel('Name', { exact: true }).fill(name);
  await page.getByLabel('Username').fill(username);
  await page.getByRole('button', { name: 'Continue' }).click();
  await expect(page).toHaveURL(/\/rooms$/);
}

export interface Person {
  context: BrowserContext;
  page: Page;
  username: string;
  name: string;
}

/** A signed-up user in their own browser context, as if on their own computer. */
export async function person(browser: Browser, prefix: string): Promise<Person> {
  const context = await browser.newContext();
  const page = await context.newPage();
  const username = uniqueName(prefix);
  const name = `${prefix[0]!.toUpperCase()}${prefix.slice(1)} ${username.slice(-3).toUpperCase()}`;
  await signUp(page, username, name);
  return { context, page, username, name };
}

/** Opens the create dialog on the rooms page and creates a room. Lands in the room. */
export async function createRoom(page: Page, topic: string, type: 'Open' | 'Followers' | 'Private' = 'Open') {
  await page.goto('/rooms');
  await page.getByRole('button', { name: 'Start a room' }).first().click();
  await page.getByLabel('Topic', { exact: true }).fill(topic);
  await page.getByRole('radio', { name: new RegExp(`^${type}`) }).check();
  await page.getByRole('button', { name: 'Open the room' }).click();
  await expect(page).toHaveURL(/\/r\/[A-Za-z0-9]{10}$/);
  await expect(page.getByRole('heading', { level: 1, name: topic })).toBeVisible();
  return page.url();
}

export function tile(page: Page, username: string) {
  return page.locator(`[data-testid="participant"][data-username="${username}"]`);
}
