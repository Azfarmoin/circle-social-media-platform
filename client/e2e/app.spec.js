import { test, expect } from '@playwright/test';

// Two real users drive the whole product through the browser: sign-up, verification,
// posting, reactions, comments, polls, friend requests and live notifications.
const stamp = Date.now().toString(36);
const A = { username: `ana_${stamp}`, email: `ana_${stamp}@e2e.test`, name: 'Ana Tester', password: 'Passw0rd!xyz' };
const B = { username: `ben_${stamp}`, email: `ben_${stamp}@e2e.test`, name: 'Ben Tester', password: 'Passw0rd!xyz' };

async function signUp(page, u) {
  await page.goto('/register');
  await page.getByLabel('Full name').fill(u.name);
  await page.getByLabel('Username').fill(u.username);
  await page.getByLabel('Email').fill(u.email);
  await page.getByLabel('Password', { exact: true }).fill(u.password);
  await page.getByRole('button', { name: 'Create account' }).click();
  // development mode shows the verification link instead of sending email
  await page.getByRole('link', { name: 'Open your verification link' }).click();
  await expect(page.getByText('Email verified')).toBeVisible();
}

async function logIn(page, u) {
  await page.goto('/login');
  await page.getByLabel('Email or username').fill(u.email);
  await page.getByLabel('Password').fill(u.password);
  await page.getByRole('button', { name: 'Log in' }).click();
  await expect(page.getByLabel("What's on your mind?")).toBeVisible();
}

test.describe.configure({ mode: 'serial' });

test('anonymous visitors are sent to the login page', async ({ page }) => {
  await page.goto('/settings');
  await expect(page).toHaveURL(/\/login/);
});

test('register, verify email and log in', async ({ browser }) => {
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  await signUp(page, A);
  await logIn(page, A);
  await expect(page.getByRole('complementary', { name: 'Primary' }).getByRole('link', { name: A.name })).toBeVisible();
  await ctx.close();
  const ctx2 = await browser.newContext();
  await signUp(await ctx2.newPage(), B);
  await ctx2.close();
});

test('wrong password shows an error and keeps the user signed out', async ({ page }) => {
  await page.goto('/login');
  await page.getByLabel('Email or username').fill(A.email);
  await page.getByLabel('Password').fill('not-the-password1');
  await page.getByRole('button', { name: 'Log in' }).click();
  await expect(page.getByRole('alert')).toContainText(/incorrect/i);
});

test('post, react, comment, reply, vote, and see it live from a friend', async ({ browser }) => {
  const ca = await browser.newContext();
  const cb = await browser.newContext();
  const pa = await ca.newPage();
  const pb = await cb.newPage();
  await logIn(pa, A);
  await logIn(pb, B);

  // Ana sends Ben a friend request from his profile; Ben accepts it
  await pa.goto(`/u/${B.username}`);
  await pa.getByRole('button', { name: 'Add friend' }).click();
  await expect(pa.getByRole('button', { name: 'Cancel request' })).toBeVisible();
  await pb.goto('/friends');
  await pb.getByRole('button', { name: 'Confirm' }).click();
  await expect(pb.getByText('No pending friend requests.')).toBeVisible();

  // Ana publishes a public text post
  await pa.goto('/');
  await pa.getByLabel("What's on your mind?").fill(`Hello from the e2e suite #e2e${stamp}`);
  await pa.getByLabel('Audience', { exact: true }).selectOption('public');
  await pa.getByRole('button', { name: 'Post', exact: true }).click();
  const post = pa.locator('article', { hasText: `Hello from the e2e suite` }).first();
  await expect(post).toBeVisible();

  // Ben sees it in his feed, reacts with Love, and comments
  await pb.goto('/');
  const bens = pb.locator('article', { hasText: 'Hello from the e2e suite' }).first();
  await expect(bens).toBeVisible();
  await bens.getByRole('button', { name: 'Like', exact: true }).hover();
  await bens.getByRole('menuitem', { name: 'Love' }).click();
  await expect(bens.getByRole('button', { name: /Love/ })).toBeVisible();
  await bens.getByRole('button', { name: 'Comment', exact: true }).click();
  await bens.getByLabel('Write a comment').fill('Great first post!');
  await bens.getByRole('button', { name: 'Send' }).click();
  await expect(bens.getByText('Great first post!')).toBeVisible();

  // Ana's counters and notifications update without a reload
  await expect(post.getByText('1 comment')).toBeVisible({ timeout: 10_000 });
  await expect(post.getByRole('button', { name: '1 reactions' })).toBeVisible();
  await pa.goto('/notifications');
  await expect(pa.getByText(/Ben Tester reacted/)).toBeVisible();
  await expect(pa.getByText('Ben Tester commented on your post')).toBeVisible();

  // Ana replies to Ben's comment
  await pa.goto('/');
  const again = pa.locator('article', { hasText: 'Hello from the e2e suite' }).first();
  await again.getByRole('button', { name: '1 comment' }).click();
  await again.getByRole('button', { name: 'Reply' }).click();
  await again.getByLabel('Write a reply').fill('Thanks Ben!');
  await again.getByRole('button', { name: 'Send' }).last().click();
  await expect(again.getByText('Thanks Ben!')).toBeVisible();

  // Poll: Ana creates one, Ben votes and sees results
  await pa.getByLabel("What's on your mind?").fill('');
  await pa.getByRole('button', { name: 'Poll' }).click();
  await pa.getByLabel('Poll question').fill('Tabs or spaces?');
  await pa.getByLabel('Option 1').fill('Tabs');
  await pa.getByLabel('Option 2').fill('Spaces');
  await pa.getByLabel('Audience', { exact: true }).selectOption('public');
  await pa.getByRole('button', { name: 'Post', exact: true }).click();
  await expect(pa.getByRole('group', { name: 'Poll: Tabs or spaces?' })).toBeVisible();
  await pb.goto('/');
  const poll = pb.getByRole('group', { name: 'Poll: Tabs or spaces?' });
  await poll.getByRole('button', { name: 'Spaces' }).click();
  await expect(poll.getByText('100%')).toBeVisible();
  await expect(poll.getByText('1 vote')).toBeVisible();

  await ca.close();
  await cb.close();
});

test('privacy: an only-me post is invisible to other people', async ({ browser }) => {
  const ca = await browser.newContext();
  const cb = await browser.newContext();
  const pa = await ca.newPage();
  const pb = await cb.newPage();
  await logIn(pa, A);
  await logIn(pb, B);
  await pa.goto('/');
  await pa.getByLabel("What's on your mind?").fill('Secret diary entry');
  await pa.getByLabel('Audience', { exact: true }).selectOption('only_me');
  await pa.getByRole('button', { name: 'Post', exact: true }).click();
  await expect(pa.getByText('Secret diary entry')).toBeVisible();
  await pb.goto(`/u/${A.username}`);
  await expect(pb.getByText('Hello from the e2e suite').first()).toBeVisible();
  await expect(pb.getByText('Secret diary entry')).toHaveCount(0);
  await ca.close();
  await cb.close();
});

test('about page and live direct messages between two people', async ({ browser }) => {
  const ca = await browser.newContext();
  const cb = await browser.newContext();
  const pa = await ca.newPage();
  const pb = await cb.newPage();
  await logIn(pa, A);
  await logIn(pb, B);

  // every account has an About page with its own URL
  await pa.goto(`/u/${B.username}/about`);
  await expect(pa.getByRole('tab', { name: 'About', selected: true })).toBeVisible();
  await expect(pa.getByRole('region', { name: 'Overview' }).getByText(`@${B.username}`)).toBeVisible();
  await expect(pa.getByRole('region', { name: 'Connections' })).toBeVisible();

  // Ana messages Ben from his profile
  await pa.getByRole('button', { name: 'Message' }).click();
  await expect(pa).toHaveURL(/\/messages\/[a-f0-9]{24}/);
  await pa.getByLabel('Message', { exact: true }).fill('Hi Ben, this is Ana');
  await pa.getByRole('button', { name: 'Send message', exact: true }).click();
  await expect(pa.getByRole('log').getByText('Hi Ben, this is Ana')).toBeVisible();

  // Ben gets it live, with an unread badge, and replies
  await pb.goto('/messages');
  await expect(pb.getByRole('log').getByText('Hi Ben, this is Ana')).toBeVisible();
  await pb.getByLabel('Message', { exact: true }).fill('Hello Ana!');
  await pb.getByLabel('Message', { exact: true }).press('Enter');
  await expect(pa.getByRole('log').getByText('Hello Ana!')).toBeVisible();
  await expect(pa.getByText('Seen')).toBeVisible();

  // online status, typing indicator, emoji and photos
  await expect(pa.getByRole('banner').or(pa.locator('header')).getByText('Online').first()).toBeVisible();
  await pb.getByLabel('Message', { exact: true }).pressSequentially('typing now');
  await expect(pa.getByText(`${B.name.split(' ')[0]} is typing…`)).toBeVisible();
  await pb.getByLabel('Message', { exact: true }).fill('');
  await pa.getByRole('button', { name: 'Add emoji' }).click();
  await pa.getByRole('button', { name: 'Insert 🎉' }).click();
  await expect(pa.getByLabel('Message', { exact: true })).toHaveValue('🎉');
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAgAAAAICAIAAABLbSncAAAACXBIWXMAAAPoAAAD6AG1e1JrAAAAEUlEQVQImWMwTvuPFTEMLQkAqBFmAWlht3MAAAAASUVORK5CYII=', 'base64');
  await pa.getByLabel('Choose photo').setInputFiles({ name: 'dot.png', mimeType: 'image/png', buffer: png });
  await expect(pa.getByAltText('Photo to send')).toBeVisible();
  await pa.getByRole('button', { name: 'Send message', exact: true }).click();
  await expect(pa.getByRole('log').getByAltText('Shared photo')).toBeVisible();
  await expect(pb.getByRole('log').getByAltText('Shared photo')).toBeVisible();

  // unsend
  const mine = pa.getByRole('log').locator('div.group', { hasText: 'Hi Ben, this is Ana' });
  await mine.hover();
  await mine.getByRole('button', { name: 'Unsend message' }).click();
  await expect(pa.getByText('Message removed')).toBeVisible();
  await expect(pb.getByText('Message removed')).toBeVisible();
  await ca.close();
  await cb.close();
});

test('theme choice persists and logging out ends the session', async ({ page }) => {
  await logIn(page, A);
  await page.goto('/settings/account');
  await page.getByRole('radio', { name: 'Dark' }).click();
  await expect(page.locator('html')).toHaveClass(/dark/);
  await page.reload();
  await expect(page.locator('html')).toHaveClass(/dark/);
  await page.getByRole('button', { name: 'Account menu' }).click();
  await page.getByRole('menuitem', { name: 'Log out' }).click();
  await expect(page).toHaveURL(/\/login/);
  await page.goto('/');
  await expect(page).toHaveURL(/\/login/);
});
