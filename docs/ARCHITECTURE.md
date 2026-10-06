# Архітектура Hub

## Сутності

| Сутність | Таблиця | Що це |
|---|---|---|
| Людина | `persons` | Один Telegram-акаунт. Теги (`tags` jsonb), контакти, нотатки, власні поля. Ключ зв'язку з усім — `telegram_user_id` |
| Ідентичність | `identities` | Чат людини з конкретним ботом (`bot_key`, `chat_id`, `blocked_at`). Без ідентичності бот не може писати людині |
| Ресурс | `resources` | Те, до чого дається право: канал (`telegram_channel`), група, функція бота (`bot_feature`, напр. `shchyro.access`), посилання. Ключ `key`, конфіг у `config` (чат, режим вступу, тексти, `enforce`, `zenedu_grants`) |
| Цифровий продукт | `funnels` з `kind = product` | Кроки з уроками, що приходять у бот. Той самий редактор, що у воронок; доступ дають оффери |
| Оффер | `plans` | Те, що продається: `payment_type` (разово/підписка), ціна, інтервал (`period`, `interval_count`), пробний період, `products[]`, `entitlements` (ресурси), тривалість доступу для разових, ліміти продажів, `design`, `settings`. Таблиця історично зветься plans, в інтерфейсі це «Оффери» |
| Оффер ZenEdu | `offers` | Імпорт, лише читання. `plan_id` зв'язує з оффером Hub для спільних звітів |
| Підписка | `subscriptions` | Факт володіння оффером: `source` (zenedu/hub), `kind` (subscription/one_time/grant), статус, період, картка, дати списання й повторів. Одна на пару «людина + оффер» |
| Право | `entitlements` | Людина має ресурс до дати. Джерела: підписка (`granted_by = subscription`), вручну, `product:<id>` для продуктів |
| Членство | `memberships` | Стан людини в каналі: invited/joined/left/kicked, посилання на вступ |
| Воронка | `funnels` з `kind = funnel` | Серія кроків із входом за `?start=f_ID`, ключовим словом або прямим запуском. Кроки `funnel_steps`, модулі, команди меню, іменовані посилання `funnel_links` з тегами |
| Проходження | `funnel_enrollments`, `funnel_deliveries` | Де людина у воронці, які кроки отримала |
| Розсилка | `broadcasts`, `broadcast_recipients`, `broadcast_clicks` | Разове повідомлення аудиторії за фільтрами (`audience` jsonb), кнопки, кліки |
| Платіж | `orders` (замовлення ZenEdu і Hub), `payment_attempts` (спроби WayForPay через Hub), `payment_methods` (токени карток) | |
| Користувач панелі | `users`, `user_sessions` | Власник і адміністратори, запрошення, сесії; `telegram_user_id` для тестів «на себе» |
| Онбординг | `onboarding_accounts` | Акаунт кабінету кандидатки, тріал, квіз, теги |

## Головний ланцюжок

```
оплата (WayForPay callback) / «Дати доступ» / посилання доступу g_<token> / імпорт ZenEdu
   → subscriptions
   → entitlements (щохвилини: syncEntitlementsFromSubscriptions, syncProductAccess)
   → канал: processGrants/processRevocations (лише ресурси з enforce = true)
   → продукти: enroll у funnels kind=product; при втраті права stopEnrollment(access_ended)
   → «Щиро»: shchyroPushChanges (grant/revoke у бота)
   → кабінет онбордингу: access_mode у профілі
```

Єдине правило «чи дає підписка доступ зараз» — `src/lib/access-rule.ts`: активна або в грейсі 24 години після кінця періоду; пауза закриває одразу. Його використовують канали, «Щиро» й кабінет.

## Cron

- `/api/cron/tick` щохвилини (`maxDuration` 60 с): кроки воронок і продуктів (`processDue`), автовидалення, доступ до каналів (`accessTick`), списання (`chargeDue`, 10:00 за Києвом, повтори 1/3/5 днів), доступ до продуктів (`syncProductAccess`), push у «Щиро», черга розсилок (~20 повідомлень/с, атомні пачки `for update skip locked`).
- `/api/cron/daily` 04:00 UTC: імпорт із ZenEdu, нагадування про списання й закінчення доступу, запрошення на переїзд (за перемикачем), повний sync «Щиро».

## Оплати

`src/lib/payments.ts`, `wayforpay.ts`. Посилання на оплату персональне: `/pay/<key>?u=<personId>.<hmac>&k=first|card|migrate`. Перший платіж на сторінці WayForPay зберігає `recToken`; далі Hub списує сам (`chargeSubscription`). Режим test/live у налаштуваннях (`payments.mode`). Поки `payments.enabled = false`, оплату бачать лише власник (`ADMIN_TELEGRAM_ID`) і список тестувальників (`payments.testers`).

## Бот

`src/lib/bot.ts`. Команди: `/start` (з payload: `f_ID[_slug]` воронка, `o_ID` оффер, `g_token` доступ без оплати, `ob_код` онбординг), `/plans`, `/subscriptions`, `/cabinet`. Медіа від команди (власник + користувачі панелі з Telegram ID) потрапляє в бібліотеку `media`. Слово «стоп» зупиняє серії.

## Інтерфейс

Next.js 15 App Router, серверні компоненти й server actions (`src/lib/actions.ts`), запити в `src/lib/queries.ts`. UI-кіт `src/components/ui` (layout.tsx серверні, controls.tsx на Radix), редактор `rich-text.tsx` (Telegram HTML), модалки на `<dialog>`. Правила в `docs/DESIGN.md`.

## Середовище для локальної перевірки

Neon через `neon-http` не працює з локальним Postgres. Для перевірки міграцій і скріншотів: локальний Postgres 16, тимчасова заміна `src/db/index.ts` на драйвер `pg` і `src/middleware.ts` на прохід без сесії (обидва файли повернути перед комітом), `npx next build && npx next start -p 3104`, скріншоти headless Chrome `/opt/pw-browsers/chromium-1194/chrome-linux/chrome --headless=new --screenshot`. Тести в браузері: `playwright-core` + `chromium_headless_shell-1194`.
