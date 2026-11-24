import { expect, test } from '@playwright/test';

test.beforeEach(({}, testInfo) => {
  test.skip(testInfo.project.name !== 'phone', 'Phone smoke runs in the 390×844 project.');
});

test('portal → album → viewer → back → portal', async ({ page }) => {
  await page.goto('/s/tadika-mawar');
  await expect(page.getByRole('heading', { name: 'Tadika Mawar' })).toBeVisible();

  await page.locator('a[aria-label="Open album Konvo 2026"]').click();
  await expect(page).toHaveURL(/\/s\/mawar-konvo-2026$/);
  await expect(page.getByRole('heading', { name: 'Konvo 2026' })).toBeVisible();
  await expect(page.locator('a.back-mobile')).toBeVisible();

  await page.locator('a.folder', { hasText: 'Cam 1' }).click();
  await expect(page).toHaveURL(/[?&]f=1/);
  const tiles = page.getByRole('button', { name: 'Open photo' });
  await expect(tiles.first()).toBeVisible();
  await tiles.first().click();
  await expect(page.getByRole('dialog', { name: 'View photo' })).toBeVisible();
  await expect(page).toHaveURL(/[?&]p=/);

  await page.getByRole('button', { name: 'Back to gallery' }).click();
  await expect(page.getByRole('dialog', { name: 'View photo' })).toBeHidden();
  await expect(page).not.toHaveURL(/[?&]p=/);

  await page.locator('a.back-mobile').click();
  await expect(page).toHaveURL(/\/s\/tadika-mawar$/);
  await expect(page.getByRole('heading', { name: 'Tadika Mawar' })).toBeVisible();
});

test('direct album open has no portal back link', async ({ page }) => {
  await page.goto('/s/mawar-konvo-2026');
  await expect(page.getByRole('heading', { name: 'Konvo 2026' })).toBeVisible();
  await expect(page.locator('a.back-mobile')).toHaveCount(0);
  await expect(page.locator('a.back-desktop')).toHaveCount(0);
});

test('deep-linked asset opens the viewer and asks the API with the album scope', async ({ page }) => {
  const assetRequests: string[] = [];
  page.on('request', (request) => {
    const url = new URL(request.url());
    if (url.pathname.startsWith('/s/api/asset/')) assetRequests.push(url.search);
  });

  // Asset from the older bucket, not loaded by the initial timeline page.
  await page.goto('/s/mawar-konvo-2026?p=mawar-konvo-2026--2026-10-1');
  await expect(page.getByRole('dialog', { name: 'View photo' })).toBeVisible();
  await expect(page.getByText('Photo not found.')).toHaveCount(0);
  expect(assetRequests.some((search) => search.includes('album=mawar-konvo-2026'))).toBe(true);
});

test('album opens on folder cards; a folder shows its photos and the breadcrumb goes back', async ({ page }) => {
  await page.goto('/s/mawar-konvo-2026');
  await expect(page.locator('a.folder')).toHaveCount(2);
  await expect(page.getByRole('button', { name: 'Open photo' })).toHaveCount(0);

  await page.locator('a.folder', { hasText: 'Cam 2' }).click();
  await expect(page).toHaveURL(/[?&]f=2/);
  await expect(page.getByRole('button', { name: 'Open photo' }).first()).toBeVisible();
  await expect(page.locator('.crumbs')).toContainText('Cam 2');

  await page.locator('.crumbs a', { hasText: 'All folders' }).click();
  await expect(page).not.toHaveURL(/[?&]f=/);
  await expect(page.locator('a.folder')).toHaveCount(2);
});

test('favourites persist in localStorage and can be cleared', async ({ page }) => {
  await page.goto('/s/mawar-konvo-2026?f=1');
  const tiles = page.getByRole('button', { name: 'Open photo' });
  await expect(tiles.first()).toBeVisible();
  await tiles.first().click();

  await page.getByRole('button', { name: 'Add to favourites' }).click();
  await expect(page.getByRole('button', { name: 'Remove from favourites' })).toHaveAttribute('aria-pressed', 'true');
  await page.getByRole('button', { name: 'Back to gallery' }).click();

  await expect(page.getByRole('button', { name: /Favourites, 1 photo\b/ })).toBeVisible();
  await page.reload();
  await expect(page.getByRole('button', { name: /Favourites, 1 photo\b/ })).toBeVisible();

  await page.getByRole('button', { name: /Favourites, 1 photo\b/ }).click();
  await expect(page).toHaveURL(/fav=1/);
  await expect(page.getByRole('heading', { name: 'Favourite (1)' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Open photo' })).toHaveCount(1);

  await page.getByRole('button', { name: 'More' }).click();
  await page.getByRole('menuitem', { name: 'Clear list' }).click();
  await expect(page.getByRole('heading', { name: 'Favourite (0)' })).toBeVisible();
  await expect(page.getByText('No favourites yet.')).toBeVisible();
});

test('album with allow_download=false hides every download control', async ({ page }) => {
  await page.goto('/s/mawar-raya-2026');
  await expect(page.getByRole('heading', { name: 'Sambutan Raya 2026' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Download all (ZIP)' })).toHaveCount(0);

  await page.getByRole('button', { name: 'Open photo' }).first().click();
  await expect(page.getByRole('dialog', { name: 'View photo' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Download this photo' })).toHaveCount(0);
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog', { name: 'View photo' })).toBeHidden();
});

test('share falls back to the sheet when navigator.share is unavailable', async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'share', { value: undefined, configurable: true });
  });
  await page.goto('/s/mawar-konvo-2026');
  await expect(page.getByRole('heading', { name: 'Konvo 2026' })).toBeVisible();

  await page.getByRole('button', { name: 'Share this album' }).click();
  const sheet = page.getByRole('dialog');
  await expect(sheet).toBeVisible();
  await expect(sheet.getByRole('heading', { name: 'Share "Konvo 2026"' })).toBeVisible();
  await expect(sheet.getByRole('button', { name: 'Copy' })).toBeVisible();
  await expect(sheet.getByRole('link', { name: 'WhatsApp' })).toHaveAttribute('href', /wa\.me/);

  await page.keyboard.press('Escape');
  await expect(sheet).toBeHidden();
});

test('unknown slug renders the not-found screen', async ({ page }) => {
  await page.goto('/s/tak-wujud');
  await expect(page.getByRole('heading', { name: 'This link was not found' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Go to johorstudio.com' })).toBeVisible();
});

test('admin route redirects to login and a valid login reaches the timeline', async ({ page }) => {
  await page.goto('/s/admin');
  await expect(page).toHaveURL(/\/s\/?\?next=/);
  await expect(page.getByRole('heading', { name: 'Admin sign in' })).toBeVisible();

  await page.getByLabel('Password').fill('password');
  await page.getByRole('button', { name: 'Sign in' }).click();

  await expect(page).toHaveURL(/\/s\/admin$/);
  await expect(page.getByRole('heading', { name: 'Timeline' })).toBeVisible();
});
