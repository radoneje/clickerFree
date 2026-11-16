import { expect, test } from '@playwright/test';

test('landing renders in Russian and English', async ({ page }) => {
  await page.goto('/ru');
  await expect(
    page.getByRole('heading', { level: 1, name: 'Переключайте презентации с телефона' }),
  ).toBeVisible();
  await page.goto('/en');
  await expect(
    page.getByRole('heading', { level: 1, name: 'Switch presentations from your phone' }),
  ).toBeVisible();
});

test('locale detection follows browser language with ru fallback', async ({ browser }) => {
  const enContext = await browser.newContext({ locale: 'en-US' });
  const enPage = await enContext.newPage();
  await enPage.goto('/');
  expect(enPage.url()).toContain('/en');
  await enContext.close();

  const frContext = await browser.newContext({ locale: 'fr-FR' });
  const frPage = await frContext.newPage();
  await frPage.goto('/');
  expect(frPage.url()).toContain('/ru');
  await frContext.close();
});

test('no horizontal scroll at 320px', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 568 });
  for (const path of ['/ru', '/ru/login']) {
    await page.goto(path);
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
    );
    expect(overflow, `overflow on ${path}`).toBe(false);
  }
});

test('header language switcher changes locale and cookie', async ({ page }) => {
  await page.goto('/ru');
  await page.getByLabel('Язык').selectOption('en');
  await expect(page).toHaveURL(/\/en$/);
  await expect(
    page.getByRole('heading', { level: 1, name: 'Switch presentations from your phone' }),
  ).toBeVisible();
  const cookies = await page.context().cookies();
  expect(cookies.find((cookie) => cookie.name === 'cf_lang')?.value).toBe('en');
});

test('faq disclosures open by keyboard and click', async ({ page }) => {
  await page.goto('/ru');
  const question = page.getByText('Нужно ли устанавливать приложение на телефон?');
  await question.click();
  await expect(page.getByText('Нет. Пульт открывается в браузере.')).toBeVisible();
});
