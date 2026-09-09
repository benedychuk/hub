# Інтеграція «Щиро» з Hub

Що змінюється в коді «Щиро»: три файли, жодних нових залежностей.

## 1. Новий модуль

Скопіювати `hub_access.py` у `bot/core/hub_access.py`.

## 2. `bot/bot/handlers.py`

Функція `is_allowed` стає такою (Hub перший, локальний список як запасний варіант):

```python
from core import hub_access

def is_allowed(user_id: int) -> bool:
    if user_id in config.ADMIN_USERS:
        return True

    hub = hub_access.check(user_id)
    if hub is not None:
        return hub.allowed

    # Hub не відповів: стара логіка — список із панелі або .env
    if settings.MEMORY_ENABLED:
        try:
            if access.has_access_list():
                return access.is_allowed(user_id)
        except Exception as e:
            logger.error(f"Помилка перевірки списку доступу: {e}")
    if config.ADMIN_USERS:
        return user_id in config.ADMIN_USERS
    if config.ALLOWED_USERS:
        return user_id in config.ALLOWED_USERS
    return False
```

Повідомлення при відмові може підказати, що робити. У `start_command` і
`handle_message` замість фіксованого тексту:

```python
def denied_text(user_id: int) -> str:
    hub = hub_access.check(user_id)
    if hub and hub.reason == "quota_exceeded":
        return "На сьогодні ліміт запитів вичерпано. Завтра я знову на зв'язку 🤍"
    tail = f"\n\nОформити доступ: {hub.offer_url}" if hub and hub.offer_url else ""
    return ("⛔ Доступ обмежено.\n\nСхоже, у тебе немає активної підписки або твій доступ ще не оновлено. "
            "Якщо ти є учасницею клубу, звернися, будь ласка, до підтримки або адміністратора." + tail)
```

У `start_command` після успішної перевірки додати один рядок, щоб Hub знав, хто
запустив «Щиро»:

```python
await asyncio.to_thread(hub_access.report_start, user)
```

У `handle_message` після відправки відповіді:

```python
await asyncio.to_thread(hub_access.report_usage, user.id)
```

Виклики йдуть через `asyncio.to_thread`, бо модуль синхронний, а обробники
python-telegram-bot асинхронні. Перевірка `hub_access.check` у `is_allowed`
лишається синхронною: вона кешована на 3 хвилини, тому мережевий запит буває
раз на людину за сесію.

## 3. `bot/.env`

```
HUB_API_URL=https://hub-two-ivory.vercel.app
HUB_API_KEY=<ключ із Hub → «Боти й меню» → «Зовнішні боти»>
HUB_RESOURCE=shchyro.access
```

Після цього `docker compose up -d --build mk-bot-lab`.

## 4. Що робить Hub

`GET /api/v1/access?telegram_user_id=…&resource=shchyro.access` повертає
`{allowed, reason, offer_url, valid_until, plan, quota}`. Право є, якщо:

1. у людини є ручне право в Hub (подарунок, тест), або
2. активна підписка Hub на тариф із правом `shchyro.access`, або
3. активна підписка ZenEdu і в ресурсу «Бот Щиро» увімкнено «давати доступ усім
   активним підпискам ZenEdu». Це перехідний режим, що повторює нинішню щоденну
   вивантажку, але оновлюється автоматично: щоночі з ZenEdu, а з вебхуком ZenEdu
   одразу після оплати чи скасування.

Щоденна вивантажка і сторінка «Доступи» в панелі «Щиро» стають непотрібними, але
лишаються запасним варіантом на випадок, якщо Hub недоступний.

## 5. Перевірка

```bash
curl -H "Authorization: Bearer $HUB_API_KEY" \
  "https://hub-two-ivory.vercel.app/api/v1/access?telegram_user_id=<ваш id>&resource=shchyro.access"
```

Очікувано `{"allowed":true,...}` для людини з підпискою і `{"allowed":false,"reason":"no_subscription",...}` без неї.
