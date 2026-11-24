import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { expect, test, type Page, type TestInfo } from '@playwright/test';

const BASE = '/s';

async function settle(page: Page) {
  await page.waitForLoadState('networkidle');
  await page.evaluate(() => document.fonts.ready);
  await page.addStyleTag({
    content: '*,*::before,*::after{transition:none!important;animation:none!important}'
  });
  await page.waitForTimeout(700);
}

async function shot(page: Page, info: TestInfo, name: string) {
  const dir = path.resolve('test-results', 'screenshots');
  await mkdir(dir, { recursive: true });
  await page.screenshot({ path: path.join(dir, `${info.project.name}-${name}.png`), fullPage: false });
}

async function adminCookie(page: Page) {
  await page.context().addCookies([
    { name: 'gallery_admin', value: '1', url: 'http://127.0.0.1:4173' }
  ]);
}

test.describe('screenshots', () => {
  test('login and admin routes', async ({ page }, info) => {
    await page.goto(`${BASE}`);
    await settle(page);
    await expect(page.getByRole('heading', { name: 'Admin sign in' })).toBeVisible();
    await shot(page, info, 'login');

    await adminCookie(page);
    for (const [name, route] of [
      ['admin-timeline', '/admin'],
      ['admin-folders', '/admin/folders'],
      ['admin-albums', '/admin/albums'],
      ['admin-album-edit', '/admin/albums/1'],
      ['admin-clients', '/admin/clients'],
      ['admin-client-albums', '/admin/clients/1'],
      ['admin-status', '/admin/status']
    ] as const) {
      await page.goto(`${BASE}${route}`);
      await settle(page);
      await shot(page, info, name);
    }
  });

  test('public portal, album, viewer, favourites, share and not-found', async ({ page }, info) => {
    await page.addInitScript(() => {
      localStorage.setItem(
        'gallery:fav:mawar-konvo-2026',
        JSON.stringify([
          'mawar-konvo-2026--pagi-1',
          'mawar-konvo-2026--pagi-2',
          'mawar-konvo-2026--pagi-5',
          'mawar-konvo-2026--tengah-hari-2'
        ])
      );
    });

    await page.goto(`${BASE}/tadika-mawar`);
    await settle(page);
    await expect(page.getByRole('heading', { name: 'Tadika Mawar' })).toBeVisible();
    await shot(page, info, 'portal');

    await page.locator('a[aria-label="Open album Konvo 2026"]').click();
    await expect(page).toHaveURL(/mawar-konvo-2026/);
    await settle(page);
    await shot(page, info, 'album-from-portal');

    await page.evaluate(() => sessionStorage.clear());
    await page.goto(`${BASE}/mawar-konvo-2026`);
    await settle(page);
    await expect(page.locator('a.back-mobile')).toHaveCount(0);
    await shot(page, info, 'album-direct');

    await page.goto(`${BASE}/mawar-konvo-2026?f=1`);
    await settle(page);
    await expect(page.getByRole('button', { name: 'Open photo' }).first()).toBeVisible();
    await shot(page, info, 'album-folder');

    await page.goto(`${BASE}/mawar-konvo-2026?p=mawar-konvo-2026--pagi-4`);
    await settle(page);
    await expect(page.getByRole('dialog', { name: 'View photo' })).toBeVisible();
    await shot(page, info, 'viewer');

    await page.goto(`${BASE}/mawar-konvo-2026?fav=1`);
    await settle(page);
    await expect(page.getByRole('heading', { name: 'Favourite (4)' })).toBeVisible();
    await shot(page, info, 'favourites');

    await page.goto(`${BASE}/mawar-konvo-2026?share=1`);
    await settle(page);
    await expect(page.getByRole('dialog')).toBeVisible();
    await shot(page, info, 'share-sheet');

    await page.goto(`${BASE}/tak-wujud`);
    await settle(page);
    await expect(page.getByRole('heading', { name: 'This link was not found' })).toBeVisible();
    await shot(page, info, 'not-found');
  });

  test('album without downloads hides every download control', async ({ page }, info) => {
    await page.goto(`${BASE}/mawar-raya-2026`);
    await settle(page);
    await expect(page.getByRole('button', { name: 'Download all (ZIP)' })).toHaveCount(0);
    await shot(page, info, 'album-no-download');
  });
});
