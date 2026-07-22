import { expect, type Page } from '@playwright/test';

const MOBILE_ENTRY = '/src/mobile/shell/dev-entry.tsx';

export async function openMobileShell(
  page: Page,
  viewport = { width: 390, height: 844 },
): Promise<void> {
  await page.setViewportSize(viewport);
  await page.goto('/?mobile=1');

  await page.addScriptTag({
    content: `
      import { mountMobileShellForDevelopment } from '${MOBILE_ENTRY}';
      mountMobileShellForDevelopment();
    `,
    type: 'module',
  });

  if (viewport.width <= 700) {
    await expect(page.getByTestId('mobile-shell')).toBeVisible();
    await expect(page.locator('body > #root')).toHaveCount(0);
  }
}
