import { expect, test, type Page } from '@playwright/test';

// A tiny valid PNG (1×1) used as the hazard photo.
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64');

async function fresh(page: Page) {
  await page.goto('/');
  await page.evaluate(() => localStorage.clear());
}

test.describe('public visitor', () => {
  test('navigates the site and explores the public map', async ({ page }) => {
    await fresh(page);
    await page.goto('/');
    await expect(page.getByRole('heading', { level: 1 })).toContainText('Your city has hazards');
    await page.getByRole('link', { name: 'Explore Safety Map' }).click();
    await expect(page).toHaveURL(/\/map/);
    await expect(page.getByText(/hazards? shown/)).toBeVisible();
    // List view alternative works without the map.
    await page.getByRole('radio', { name: 'List' }).click();
    await expect(page.getByRole('button', { pressed: false }).filter({ hasText: /Open manhole|Pothole|Live wire|wire/i }).first()).toBeVisible();
  });

  test('cannot use municipal tools while signed out', async ({ page }) => {
    await fresh(page);
    await page.goto('/dashboard');
    await expect(page).toHaveURL(/\/login\?next=%2Fdashboard/);
  });

  test('citizens are refused dashboard access', async ({ page }) => {
    await fresh(page);
    await page.goto('/login');
    await page.getByRole('button', { name: 'citizen' }).click();
    await page.goto('/dashboard');
    await expect(page.getByText('You don’t have access to this area')).toBeVisible();
  });
});

test.describe('reporting', () => {
  test('submits a hazard with a photo and location and gets a unique ID', async ({ page }) => {
    await fresh(page);
    await page.goto('/report');
    await page.getByRole('radio', { name: /Open manhole/ }).click();
    await page.getByRole('button', { name: 'Continue' }).click();
    await page.locator('input[type=file][multiple]').first().setInputFiles({ name: 'hazard.png', mimeType: 'image/png', buffer: PNG });
    await expect(page.getByRole('img', { name: 'Attached photo 1' })).toBeVisible();
    await page.getByLabel(/Description/).fill('Cover missing near the bus stop');
    await page.getByRole('button', { name: 'Continue' }).click();
    // Location: refuse to continue until a pin is set, then tap the map.
    await page.getByRole('button', { name: 'Continue' }).click();
    await expect(page.getByText(/Set the location/)).toBeVisible();
    await page.locator('.leaflet-container').click({ position: { x: 200, y: 160 } });
    await expect(page.getByText('Pin placed')).toBeVisible();
    await page.getByRole('button', { name: 'Continue' }).click();
    await page.getByRole('radiogroup', { name: 'Is it actively endangering people?' }).getByRole('radio', { name: 'Yes' }).click();
    await page.getByRole('radiogroup', { name: 'Is it blocking the road?' }).getByRole('radio', { name: 'No' }).click();
    await page.getByRole('button', { name: 'Continue' }).click();
    await expect(page.getByRole('heading', { name: 'Review and send' })).toBeVisible();
    await page.getByRole('button', { name: 'Send report' }).click();
    await expect(page.getByRole('heading', { name: 'Report received' })).toBeVisible();
    const ref = await page.locator('text=/^CL-[A-Z2-9]{6}$/').textContent();
    expect(ref).toMatch(/^CL-/);
    await expect(page.getByText('Critical')).toBeVisible();
    // Persisted: it appears on the tracking page after a reload.
    await page.getByRole('link', { name: 'Track this report' }).click();
    await page.reload();
    await expect(page.getByText(ref!)).toBeVisible();
    await expect(page.getByRole('img', { name: /Reported open manhole/ })).toBeVisible();
  });

  test('keyboard users can complete the reporting workflow', async ({ page }) => {
    await fresh(page);
    await page.goto('/report');
    const radio = page.getByRole('radio', { name: /Pothole or damaged road/ });
    await radio.focus();
    await page.keyboard.press('Enter');
    await page.getByRole('button', { name: 'Continue' }).focus();
    await page.keyboard.press('Enter');
    await page.getByRole('button', { name: 'Skip for now' }).focus();
    await page.keyboard.press('Enter');
    // Place the pin without a pointer: coordinates entry.
    await page.getByText('Enter coordinates instead').focus();
    await page.keyboard.press('Enter');
    await page.getByLabel('Latitude').focus();
    await page.keyboard.type('12.9725');
    await page.keyboard.press('Tab');
    await page.keyboard.type('77.5951');
    await page.keyboard.press('Tab');
    await page.keyboard.press('Enter');
    await expect(page.getByText('Pin placed')).toBeVisible();
    await page.getByRole('button', { name: 'Continue' }).focus();
    await page.keyboard.press('Enter');
    for (const [group, answer] of [['Is it actively endangering people?', 'No'], ['Is it blocking the road?', 'Yes']] as const) {
      await page.getByRole('radiogroup', { name: group }).getByRole('radio', { name: answer }).focus();
      await page.keyboard.press('Enter');
    }
    await page.getByRole('button', { name: 'Continue' }).focus();
    await page.keyboard.press('Enter');
    await page.getByRole('button', { name: 'Send report' }).focus();
    await page.keyboard.press('Enter');
    await expect(page.getByRole('heading', { name: 'Report received' })).toBeVisible();
  });

  test('shows clear errors for invalid uploads', async ({ page }) => {
    await fresh(page);
    await page.goto('/report');
    await page.getByRole('radio', { name: /Pothole/ }).click();
    await page.getByRole('button', { name: 'Continue' }).click();
    await page.locator('input[type=file][multiple]').first().setInputFiles({ name: 'notes.txt', mimeType: 'text/plain', buffer: Buffer.from('hello') });
    await expect(page.getByRole('alert').filter({ hasText: 'isn’t a supported file' })).toBeVisible();
  });
});

test.describe('municipal workflow', () => {
  test('staff triage, assign and submit repair; reviewer approves', async ({ page }) => {
    await fresh(page);
    await page.goto('/login');
    await page.getByRole('button', { name: 'staff' }).click();
    await expect(page).toHaveURL(/\/dashboard/);
    await page.goto('/dashboard/queue');
    await expect(page.getByRole('heading', { name: 'Priority queue' })).toBeVisible();
    await expect(page.getByText(/incidents? · page 1/)).toBeVisible();
    await page.goto('/hazards/demo-003'); // a demo pothole that is in progress
    await page.getByRole('button', { name: 'Submit repair' }).click();
    await page.getByLabel(/After-repair photo/).setInputFiles({ name: 'after.png', mimeType: 'image/png', buffer: PNG });
    await page.getByLabel(/Repair summary/).fill('Pothole filled and compacted, surface sealed.');
    await page.getByRole('dialog').getByRole('button', { name: 'Submit repair' }).click();
    await expect(page.getByText('Verification pending').first()).toBeVisible();

    // Audit trail
    await expect(page.getByText('Pothole filled and compacted, surface sealed.').first()).toBeVisible();

    await page.getByRole('button', { name: /Account menu/ }).click();
    await page.getByRole('button', { name: 'Sign out' }).click();
    await page.goto('/login');
    await page.getByRole('button', { name: 'reviewer' }).click();
    await page.goto('/verify/demo-003');
    await page.getByRole('button', { name: 'Approve repair' }).click();
    await page.getByRole('dialog').getByRole('button', { name: 'Approve repair' }).click();
    await expect(page.getByText('Verified resolved').first()).toBeVisible();
  });
});

test.describe('resilience', () => {
  test('works without WebGL (CSS fallback)', async ({ page }) => {
    await fresh(page);
    await page.goto('/?nowebgl');
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    await expect(page.locator('canvas')).toHaveCount(0);
  });

  test('works when geolocation is denied', async ({ page, context }) => {
    await context.clearPermissions();
    await fresh(page);
    await page.goto('/report');
    await page.getByRole('radio', { name: /Fallen tree/ }).click();
    await page.getByRole('button', { name: 'Continue' }).click();
    await page.getByRole('button', { name: 'Skip for now' }).click();
    await page.getByRole('button', { name: 'Use my location' }).click();
    await expect(page.getByText(/declined|couldn’t get your location|not available/i)).toBeVisible({ timeout: 15000 });
    await page.locator('.leaflet-container').click({ position: { x: 120, y: 120 } });
    await expect(page.getByText('Pin placed')).toBeVisible();
  });

  test('has no horizontal scroll on small screens', async ({ page }) => {
    await page.setViewportSize({ width: 360, height: 740 });
    for (const path of ['/', '/map', '/report', '/login']) {
      await page.goto(path);
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
      expect(overflow, path).toBe(false);
    }
  });
});
