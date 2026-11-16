import { expect, test } from '@playwright/test';

test('dev login lands in cabinet; profile language is independent of URL locale', async ({
  page,
}) => {
  await page.goto('/ru/login');
  await page.getByRole('link', { name: 'Тестовый вход (только разработка)' }).click();
  await expect(page).toHaveURL(/\/ru\/cabinet/);
  await expect(page.getByText('Пока нет привязанных компьютеров.')).toBeVisible();

  await page.goto('/ru/settings');
  await page.getByLabel('Язык сайта').selectOption('en');
  await page.getByRole('button', { name: 'Сохранить' }).click();
  await expect(page).toHaveURL(/\/en\/settings/);
  await expect(page.getByRole('heading', { name: 'Account settings' })).toBeVisible();

  // Профиль сменился на en, но явная URL-локаль управляет отображением.
  await page.goto('/ru/settings');
  await expect(page.getByRole('heading', { name: 'Настройки аккаунта' })).toBeVisible();

  await page.getByRole('button', { name: 'Выйти' }).click();
  await expect(page).toHaveURL(/\/ru\/login/);
  await page.goto('/ru/cabinet');
  await expect(page).toHaveURL(/\/ru\/login/);
});

test('login page is keyboard operable', async ({ page }) => {
  await page.goto('/ru/login');
  const link = page.getByRole('link', { name: 'Тестовый вход (только разработка)' });
  await link.focus();
  await expect(link).toBeFocused();
  await page.keyboard.press('Enter');
  // Общий dev-пользователь мог сменить язык профиля в соседнем тесте.
  await expect(page).toHaveURL(/\/(ru|en)\/cabinet/);
});

test('anonymous cabinet and settings redirect to login', async ({ page }) => {
  await page.goto('/ru/cabinet');
  await expect(page).toHaveURL(/\/ru\/login/);
  await page.goto('/en/settings');
  await expect(page).toHaveURL(/\/en\/login/);
});
