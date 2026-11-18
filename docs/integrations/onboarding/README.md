# Платформа онбордингу як частина Hub

Кабінет кандидатки (`MK_ONBOARDING_PLATFORM`) більше не живе лише в
`localStorage`: акаунт зберігається в Hub, Telegram ID є головним ключем,
кожна дія стає тегом у картці людини, а результат квізу потрапляє в пам'ять
бота «Щиро». Реалізація ТЗ `TZ_ONBOARDING_PLATFORM_INTEGRATION.md`.

## Де це в Hub

- **Продукти → Онбординг** (`/onboarding`): воронка кандидаток (реєстрація →
  Telegram → квіз → тести → анкета → кліки на клуб і «Щиро»), стани тріалу,
  розподіл за сценаріями кризи, список акаунтів із фільтрами, усі теги матриці.
- **Картка людини**: блок «Онбординг» (кабінет, тріал, квіз, тести, анкета,
  теги) і дві дії: «Посилання в кабінет» (показати) та «Надіслати в бот».
- **Hub-бот**: команда `/cabinet` і кнопка «Особистий кабінет» у `/start`
  дають одноразове посилання з автологіном (48 годин). Deep link
  `?start=ob_<код>` з confirm.html підтверджує кабінет і прив'язує його до
  Telegram.
- **Люди**: фільтр за тегом показує, хто пройшов квіз, у кого закінчується
  тріал тощо (`/people?tag=crisis_lost_boundaries`).

## Доступ до кабінету

Єдине правило «учасниця клубу» (`src/lib/clubAccess`, файл `src/lib/club.ts`) — однакове для кабінету, етерів і перевірок:

- **Учасниця**, якщо хоч одне:
  - чинна підписка ZenEdu (з 7 днями запасу на продовження);
  - чинна підписка Hub на оффер клубу (оффер відкриває канал або групу; бойова оплата, посилання доступу чи видача вручну);
  - чинне право на канал або групу клубу;
  - людина з команди Hub (`ADMIN_TELEGRAM_ID`, користувачі панелі з Telegram ID) або тестувальник оплат.
- **Доступ учасниці** — безстроково, поки діє підписка: `access_mode: "subscription"`, `access_active: true`, `club_member: true`, `club_access_via`.
- **Колишня учасниця** (мала підписку клубу, зараз немає) і **повернення коштів** — `access_mode: "subscription_ended"`, `access_active: false`. Пробний період не відкривається знову.
- **Без підписки клубу** — доступу немає (`access_mode: "no_subscription"`, `access_active: false`). **Пробного періоду немає**: колишні 14 + 7 днів прибрано, анкета більше не додає днів, щоденні теги тріалу не ставляться. Для сумісності поля `trial_*` у профілі повторюють доступ за підпискою (`trial_state`: `subscription` / `subscription_ended` / `no_subscription`).
- **Не учасниці** — тестова оплата без бойової і підписка Hub на продукт не з клубу (курс тощо).

## Дані

Таблиця `onboarding_accounts` (міграція `0013`): акаунт кабінету з
`person_id` (порожній до підтвердження Telegram), контактом (паролів немає: вхід лише через Telegram; старе поле password_hash не використовується),
кодом deep link, тріалом (`trial_ends_at`, `extension_count`), результатами
квізу й тестів, анкетою, тегами. Події пишуться в `events` як
`onboarding.<event_type>`, теги в `persons.tags` і `onboarding_accounts.tags`.
Таблиці `user_tags` і `user_events` з ТЗ не створювались: їхню роль виконують
наявні `persons.tags` та `events`.

## API для платформи (`/api/v1/onboarding/*`, CORS)

| Метод | Що робить |
|---|---|
| `POST auth/register` `{name, contact}` | акаунт + `session_token` + `user.telegram_link` для підтвердження через бот; 409, якщо контакт уже є (тоді — вхід через Telegram). Поле `password` ігнорується |
| `POST auth/login` | **вимкнено** (2026-11-17): завжди 410 `password_login_disabled`. Вхід лише через Telegram |
| `POST auth/telegram` (дані Telegram Login Widget) | вхід через Telegram: підпис перевіряється ключем Hub-бота, кабінет знаходиться за Telegram ID або створюється |
| `POST auth/set-password` (Bearer) | **вимкнено**: нічого не зберігає, відповідає `success: true, ignored: true` (щоб стара форма не блокувала людину). У профілі `login_method: "telegram"`, `must_set_password: false` |
| `POST auth/telegram-bot/start` `{next?}` | вхід в один дотик через Hub-бота: одноразовий код (5 хв) і `bot_url` = `t.me/<бот>?start=login_<код>`. `next` (`efir.html`, `cabinet.html`…) — куди веде кнопка в боті після підтвердження («Відкрити етер» для `efir.html`) |
| `GET auth/telegram-bot/status?code=` | `pending` → `confirmed` (`session_token`, `user` — віддаються один раз) або `expired`. Бот підтверджує вхід лише кнопкою «Так, це я входжу», не самим Start |
| `POST auth/telegram-webapp` `{init_data}` | сайт відкрито всередині Telegram: підпис initData перевіряється ключем Hub-бота → `session_token`, `user` |
| профіль (`user` у відповіді входу й `GET user/profile`) | містить `stream` — актуальний етер (як `streams/current`) для учасниць, щоб банер і `efir.html` показувались одразу; `auth/telegram-webapp` також повертає `next` |
| `GET streams/current` (Bearer необов'язково) | актуальний етер для банера й `efir.html`: назва, час, стан (upcoming/today/live/recent), чи додано посилання; `member` — чи учасниця клубу. Посилання YouTube не віддається |
| `GET streams/archive` (Bearer) | найближчий етер (`current`) і записи завершених етерів за 30 днів, не більше 4, найновіші спершу (`archive`: code, title, starts_at, has_link, available_until). ТЗ: `TZ-efir-archive.md` |
| `POST streams/watch` (Bearer) `{code?}` | записує перехід на етер і повертає посилання YouTube; помилки `not_member`, `no_link_yet`, `no_telegram` (див. `TZ-efir.md`) |
| `POST auth/magic-login` (Bearer `auth_token` або в тілі) | вхід за посиланням з бота: одноразовий токен, 48 годин |
| `GET user/profile` (Bearer `session_token`) | профіль: тріал, підписка, квіз, тести, анкета, теги, `telegram_linked` |
| `POST events/track` `{event_type, tag?, page?, payload?}` | подія матриці → тег у картку, запис в історію; `quiz_completed` додатково оновлює пам'ять «Щиро» |
| `POST feedback/submit` `{answers, guest?}` | анкета, тег `feedback_completed`, +7 днів один раз; гість без сесії реєструється тут же |

Токени підписані HMAC (`ONBOARDING_TOKEN_SECRET`, інакше `SESSION_SECRET`),
без таблиці сесій. Дозволені події: `onboarding_registered`, `quiz_started`,
`quiz_completed`, `deep_quiz_test_completed`, `deep_quiz_completed`,
`diagnostic_completed`, `feedback_completed`, `cta_club_clicked`,
`cta_schyro_clicked`, `video_lesson_N_opened`, `cabinet_opened`, стани тріалу.
Теги сценаріїв (`crisis_*`) ставить сам Hub за `quiz_result_id`.

### Змінні оточення Hub

```
ONBOARDING_URL=https://mariia-kravchuk.com.ua/app   # куди вести magic link (без слеша в кінці)
ONBOARDING_TOKEN_SECRET=<випадковий рядок>           # необов'язково; інакше SESSION_SECRET
ONBOARDING_ORIGINS=https://mariia-kravchuk.com.ua    # необов'язково; CORS, через кому; інакше origin з ONBOARDING_URL
```

## Міст у «Щиро» (ТЗ, розділ 5)

Після `quiz_completed` (або щойно акаунт прив'яжеться до Telegram) Hub викликає
`POST /api/v1/hub/clients/{telegram_id}/onboarding` у «Щиро»: у картку пам'яті
додається рядок `[onboarding] Клієнтка пройшла онбординг… сценарій N…` і
структуровані дані в `profile_json.onboarding`. Повторний квіз замінює рядок,
історія діалогу не чіпається. Потрібне підключення «Щиро» (`SHCHYRO_API_URL`,
`SHCHYRO_API_SECRET`).

## Щоденний крон

`/api/cron/daily` → `onboardingDaily()`: теги `trial_expiring_soon` (менше
72 годин), `trial_14_expired`, `trial_fully_expired` ставляться один раз.

## Що змінено на платформі (`MK_ONBOARDING_PLATFORM`)

- `src/js/config.js`: адреса Hub і username ботів. Порожній `apiBase` вимикає
  інтеграцію, платформа працює на `localStorage`, як раніше.
- `src/js/api-client.js` (`window.MKApi`): реєстрація, вхід, magic link,
  профіль, події, анкета; сесія в `mk_session_token`; профіль з Hub пишеться у
  звичний `mk_user_data`; невідправлені події чекають у `mk_pending_events`.
- `auth.js`: реєстрація і вхід через Hub, локальний режим як резерв.
- `confirm.js`: кнопка Telegram веде на персональний deep link `ob_<код>`.
- `cabinet.js`: автологін за `?auth_token=`, оновлення профілю з Hub, банер
  «Підтвердьте через Telegram», події кліків на клуб, «Щиро», відеоуроки.
- `quiz.js`, `deep-quiz.js`, `diagnostic.js`, `feedback.html`: події матриці.
- Усі сторінки підключають `config.js` і `api-client.js` першими.
- Локальна адмінка платформи (`adminmkon.html`) лишилась як є: її роль
  виконує розділ «Онбординг» у Hub.

## Перевірка (етап 4 ТЗ)

1. Реєстрація на платформі → акаунт у `/onboarding`, тег
   `onboarding_registered`.
2. Кнопка «Підтвердити через Telegram» → у боті «Кабінет підключено», у Hub
   акаунт отримує Telegram, тег у картці людини.
3. Квіз (сценарій 2) → тег `crisis_lost_boundaries`, подія в історії, у
   «Щиро» картка клієнтки отримує рядок `[onboarding]`.
4. Відео 1 → `video_lesson_1_opened`; анкета → `feedback_completed`,
   `trial_extended_7_days`, тріал +7 днів; клік «Щиро» → `cta_schyro_clicked`.
5. `/cabinet` у боті → кабінет відкривається без пароля з іншого пристрою з
   тими самими результатами.
