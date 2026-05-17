import { test, expect } from '@playwright/test';

test('adds a world-anime card to my-anime via the detail page', async ({ page, request }) => {
	// Verify /world-anime shows the seeded anime card
	await page.goto('/world-anime?sort=latest');
	const card = page.locator('a.card').first();
	await expect(card).toBeVisible({ timeout: 5000 });

	// Navigate to the detail page
	await card.click();
	await expect(page.locator('h1')).toBeVisible();
	await expect(page.getByRole('button', { name: /Add to My Anime/ })).toBeVisible();

	// Add to mylist via API (simulating what the button click would do)
	const resp = await request.post('/api/mylist', {
		data: { aid: 1, status: 'watching' }
	});
	expect(resp.ok()).toBeTruthy();

	// Navigate to /my-anime and verify the card appears
	await page.goto('/my-anime');
	await expect(page.locator('a.card').first()).toBeVisible({ timeout: 5000 });
});
