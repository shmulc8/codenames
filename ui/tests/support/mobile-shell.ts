import { expect, type Page } from '@playwright/test';

export const MOBILE_PORTRAIT = { width: 390, height: 844 } as const;
export const MOBILE_LANDSCAPE = { width: 700, height: 390 } as const;

// Post-integration: MainScreen delegates to MobileShell purely on useLayout()
// (viewport/pointer), so tests exercise the real app — no dev-entry injection.
export async function openMobileShell(
  page: Page,
  viewport: { width: number; height: number } = MOBILE_LANDSCAPE,
): Promise<void> {
  await page.setViewportSize(viewport);
  await page.goto('/');

  if (viewport.width <= 700) {
    await expect(page.getByTestId('mobile-shell')).toBeVisible();
  }
}
