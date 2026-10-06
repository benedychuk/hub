# Hub — платформа керування клубом Марії Кравчук

Next.js 15 + Drizzle + Neon Postgres + grammY. Деплой на Vercel.

- Панель: `/` (дашборд), `/people`, `/chats`, `/subscriptions`, `/payments`, `/plans`, `/resources`, `/shchyro`, `/onboarding`, `/funnels`, `/broadcasts`, `/automations`, `/bots`, `/migration`, `/settings`
- Бот: вебхук `/api/telegram/hub`, вмикається кнопкою на сторінці «Боти й меню»
- Імпорт із ZenEdu: сторінка «Налаштування», щоденний cron `/api/cron/daily` о 04:00
- Вебхук ZenEdu: `/api/webhooks/zenedu?key=<ZENEDU_WEBHOOK_SECRET>`
- Онбординг: розділ Продукти → Онбординг (`/onboarding`), API `/api/v1/onboarding/*` для кабінету кандидатки, `/cabinet` у боті; змінні `ONBOARDING_URL`, `ONBOARDING_TOKEN_SECRET`; деталі в `docs/integrations/onboarding/README.md`
- Бот «Щиро»: розділ Продукти → Бот «Щиро» (`/shchyro`): доступ за підписками, люди, аналітика; API `SHCHYRO_API_URL`, `SHCHYRO_API_SECRET`; автоматика вимкнена за замовчуванням; деталі в `docs/integrations/shchyro/README.md`

Змінні оточення — у `.env.example`. Міграції застосовуються під час збірки, якщо задано `DATABASE_URL`.
Контекст, архітектура, рішення, план переїзду, журнал — у `docs/` (почати з `docs/CONTEXT.md`). Історичні аналізи ZenEdu — у репозиторії mkravchuk.com, тека `docs/community-platform/`.
