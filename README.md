# Hub — платформа керування клубом Марії Кравчук

Next.js 15 + Drizzle + Neon Postgres + grammY. Деплой на Vercel.

- Панель: `/` (дашборд), `/people`, `/chats`, `/subscriptions`, `/payments`, `/plans`, `/resources`, `/funnels`, `/broadcasts`, `/automations`, `/bots`, `/migration`, `/settings`
- Бот: вебхук `/api/telegram/hub`, вмикається кнопкою на сторінці «Боти й меню»
- Імпорт із ZenEdu: сторінка «Налаштування», щоденний cron `/api/cron/daily` о 04:00
- Вебхук ZenEdu: `/api/webhooks/zenedu?key=<ZENEDU_WEBHOOK_SECRET>`

Змінні оточення — у `.env.example`. Міграції застосовуються під час збірки, якщо задано `DATABASE_URL`.
Документи з аналізом і баченням — у репозиторії mkravchuk.com, тека `docs/community-platform/`.
