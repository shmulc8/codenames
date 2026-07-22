import { expect, type Page } from '@playwright/test';

// Post-integration: MainScreen delegates to MobileShell purely on useLayout()
// (viewport/pointer), so tests exercise the real app — no dev-entry injection.
export async function openMobileShell(
  page: Page,
  viewport = { width: 390, height: 844 },
): Promise<void> {
  await page.setViewportSize(viewport);
  await page.goto('/');

  if (viewport.width <= 700) {
    await expect(page.getByTestId('mobile-shell')).toBeVisible();
  }
}
