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

- Кандидатка без підписки: тріал 14 днів від реєстрації, +7 за анкету.
- Учасниця з підпискою (Hub або ZenEdu): кабінет без таймера, доступ діє,
  поки діє підписка, за єдиним правилом із грейсом 24 години
  (`src/lib/access-rule.ts`). Після оплати бот сам надсилає кнопку
  «Відкрити кабінет» і створює акаунт платформи.
- Коли підписка закінчується і минає грейс, кабінет показує «доступ
  завершено» з пропозицією продовжити. Теги станів тріалу учасницям з
  підпискою не ставляться.

Профіль (`user/profile`, `magic-login`) віддає `access_mode`
(`subscription` | `subscription_ended` | `trial`), `access_until`,
`access_active`; платформа ховає таймер і показує «за підпискою».

## Дані

Таблиця `onboarding_accounts` (міграція `0013`): акаунт кабінету з
`person_id` (порожній до підтвердження Telegram), контактом, паролем (scrypt),
кодом deep link, тріалом (`trial_ends_at`, `extension_count`), результатами
квізу й тестів, анкетою, тегами. Події пишуться в `events` як
`onboarding.<event_type>`, теги в `persons.tags` і `onboarding_accounts.tags`.
Таблиці `user_tags` і `user_events` з ТЗ не створювались: їхню роль виконують
наявні `persons.tags` та `events`.

## API для платформи (`/api/v1/onboarding/*`, CORS)

| Метод | Що робить |
|---|---|
| `POST auth/register` `{name, contact, password?}` | акаунт + `session_token` + `user.telegram_link` для підтвердження через бот; 409, якщо контакт уже є |
| `POST auth/login` `{contact, password}` | вхід за контактом і паролем |
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
