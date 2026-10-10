import { expect, test } from '@playwright/test';
import { createRoom, person, tile } from './helpers';

// Two people, two browser contexts with fake microphones that play a tone.
// "data-speaking" on a remote tile is driven by the audio level of the received
// WebRTC stream, so it only turns true when audio really flows between browsers.

test('people in a room hear each other, and the host runs the stage', async ({ browser }) => {
  test.slow();
  const host = await person(browser, 'anchor');
  const guest = await person(browser, 'caller');
  const topic = `Voice check ${host.username}`;
  const url = await createRoom(host.page, topic);

  // The host's microphone starts muted; unmuting lights the on-air button.
  const hostMic = host.page.getByRole('button', { name: 'Unmute' });
  await expect(hostMic).toBeEnabled();
  await hostMic.click();
  await expect(host.page.getByRole('button', { name: 'On air' })).toHaveAttribute('aria-pressed', 'true');

  await guest.page.goto(url);
  const hostSeenByGuest = tile(guest.page, host.username);
  await expect(hostSeenByGuest).toHaveAttribute('data-role', 'speaker');
  await expect(hostSeenByGuest).toHaveAttribute('data-connection', 'connected');
  await expect(hostSeenByGuest).toHaveAttribute('data-muted', 'false');
  await expect(hostSeenByGuest).toHaveAttribute('data-speaking', 'true');
  // The guest plays the host's audio only while the server lists the host as an unmuted speaker.
  await expect(guest.page.locator('audio[data-audible="true"]')).toHaveCount(1);

  // The guest listens, and raises a hand.
  const guestSeenByHost = tile(host.page, guest.username);
  await expect(guestSeenByHost).toHaveAttribute('data-role', 'listener');
  await expect(guest.page.getByRole('button', { name: 'Unmute' })).toHaveCount(0);
  await guest.page.getByRole('button', { name: 'Raise hand' }).click();
  await expect(guestSeenByHost).toHaveAttribute('data-hand', 'true');
  await expect(host.page.getByText('1 hand up')).toBeVisible();

  // The host invites the guest up; the guest's microphone starts and they talk.
  await guestSeenByHost.getByRole('button', { name: 'Invite to speak' }).click();
  await expect(guestSeenByHost).toHaveAttribute('data-role', 'speaker');
  await expect(guestSeenByHost).toHaveAttribute('data-hand', 'false');
  const guestMic = guest.page.getByRole('button', { name: 'Unmute' });
  await expect(guestMic).toBeEnabled();
  await guestMic.click();
  await expect(guestSeenByHost).toHaveAttribute('data-muted', 'false');
  await expect(guestSeenByHost).toHaveAttribute('data-speaking', 'true');

  // Muting reaches the other side and silences the meter.
  await host.page.getByRole('button', { name: 'On air' }).click();
  await expect(hostSeenByGuest).toHaveAttribute('data-muted', 'true');
  await expect(hostSeenByGuest).toHaveAttribute('data-speaking', 'false');
  // The host hears the guest, but the guest no longer plays the muted host.
  await expect(guest.page.locator('audio[data-audible="true"]')).toHaveCount(0);

  // Moving the guest back to the audience takes their microphone away.
  await guestSeenByHost.getByRole('button', { name: 'Move to audience' }).click();
  await expect(guestSeenByHost).toHaveAttribute('data-role', 'listener');
  await expect(guest.page.getByRole('button', { name: 'Raise hand' })).toBeVisible();

  // Ending the room sends everyone home.
  await host.page.getByRole('button', { name: 'End room' }).click();
  await host.page.getByRole('button', { name: 'Confirm: end for everyone' }).click();
  await expect(guest.page.getByRole('heading', { name: 'This room has ended' })).toBeVisible();
  await expect(host.page.getByRole('heading', { name: 'This room has ended' })).toBeVisible();
});

test('leaving a room updates everyone else', async ({ browser }) => {
  const host = await person(browser, 'stay');
  const guest = await person(browser, 'drift');
  const url = await createRoom(host.page, `Drop in ${host.username}`);
  await guest.page.goto(url);
  await expect(tile(host.page, guest.username)).toBeVisible();

  await guest.page.getByRole('button', { name: 'Leave quietly' }).click();
  await expect(guest.page).toHaveURL(/\/rooms$/);
  await expect(tile(host.page, guest.username)).toHaveCount(0);
});

test('opening the room in a second tab moves you there', async ({ browser }) => {
  const host = await person(browser, 'twotabs');
  const url = await createRoom(host.page, `Two tabs ${host.username}`);
  const second = await host.context.newPage();
  await second.goto(url);
  await expect(tile(second, host.username)).toHaveAttribute('data-connection', 'self');
  await expect(host.page.getByRole('heading', { name: 'You are in this room in another tab' })).toBeVisible();
});
