'use client';

import { usePathname, useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';

function csrfToken(): string {
  const match = document.cookie.match(/(?:^|;\s*)cf_csrf=([^;]*)/);
  return match?.[1] ?? '';
}

export function LocaleSwitcher({ locale, isAuthed }: { locale: string; isAuthed: boolean }) {
  const router = useRouter();
  const pathname = usePathname();
  const t = useTranslations('header');

  async function onChange(next: string) {
    if (isAuthed) {
      await fetch('/api/me/language', {
        method: 'PATCH',
        headers: { 'x-csrf-token': csrfToken(), 'content-type': 'application/json' },
        body: JSON.stringify({ lang: next }),
      }).catch(() => null);
    }
    // Клиентская навигация не обновляет cookie локали — фиксируем выбор явно.
    document.cookie = `cf_lang=${next}; path=/; max-age=31536000; samesite=lax`;
    const rest = pathname.replace(/^\/(ru|en)(?=\/|$)/, '');
    router.push(`/${next}${rest}`);
    router.refresh();
  }

  return (
    <select
      aria-label={t('locale')}
      className="rounded border border-neutral-300 bg-white px-2 py-1 text-sm"
      value={locale}
      onChange={(event) => void onChange(event.target.value)}
    >
      <option value="ru">Русский</option>
      <option value="en">English</option>
    </select>
  );
}
