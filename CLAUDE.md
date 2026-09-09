# Hub — інструкції для роботи з кодом

- Перед будь-якою зміною інтерфейсу прочитай `docs/DESIGN.md` і виконай його чекліст. Це обов’язково, не рекомендація.
- Нові екрани будуються з компонентів `src/components/ui` (PageHeader, Stepper, Section, Field, FormRow, Checkbox, Switch, Segmented, RadioCards, Kebab, Modal, Stat, EmptyState, Alert, RichText). Не створюй локальних варіантів цих компонентів у сторінках.
- Іконки лише з `lucide-react`. Емодзі в інтерфейсі не використовуються.
- Кольори, відступи, радіуси, тіні лише через токени `globals.css`. Інлайн-стилі тільки для динамічних значень.
- Одна головна дія на екран. Деструктивні дії у меню ⋮ з підтвердженням.
- Перед пушем: `npx tsc --noEmit`, `npm run lint`, `npx next build`, і знімок екрана зміненої сторінки (локальний `next start` + headless Chrome `/opt/pw-browsers/chromium-1194/chrome-linux/chrome --headless=new --screenshot`).
- Коміти від імені `Oleksandr Benedychuk <benedichuk@icloud.com>`, повідомлення українською.
- Секрети ніколи не потрапляють у код, логи чи документацію.
