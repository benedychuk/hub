import { Bot, KeyRound, Power, RefreshCw } from "lucide-react";
import Shell from "@/components/shell";
import { Pill } from "@/components/ui";
import { Section, Field, FormRow, Row, KV, Alert, EmptyState } from "@/components/ui/layout";
import { Kebab, MenuAction } from "@/components/ui/controls";
import { CopyBox } from "../settings/copy-box";
import { navCounts, botList, resourceList } from "@/lib/queries";
import { setupWebhook, createExternalBot, rotateBotKey, toggleBot } from "@/lib/actions";
import { appUrl, webhookInfo } from "@/lib/bot";
import { dateTime } from "@/lib/format";

export const dynamic = "force-dynamic";

export default async function Bots({ searchParams }: { searchParams: Promise<{ newkey?: string; for?: string }> }) {
  const sp = await searchParams;
  const [counts, list, res] = await Promise.all([navCounts(), botList(), resourceList()]);
  const ext = list.filter((b) => b.mode === "external");
  const base = appUrl();
  const hasToken = Boolean(process.env.TELEGRAM_BOT_TOKEN);
  const info = hasToken ? await webhookInfo() : null;
  const hub = list.find((b) => b.key === "hub");
  const zen = list.filter((b) => b.role === "zenedu");
  const url = (info as { url?: string })?.url;
  return (
    <Shell title="Боти й меню" counts={counts}>
      {sp.newkey && <Section title={`API-ключ для бота «${sp.for}»`} description="Показується один раз. Скопіюйте й передайте інженеру безпечним каналом." className="sec"><CopyBox text={sp.newkey} /></Section>}
      <div className="grid g21" style={{ marginTop: sp.newkey ? 16 : 0 }}>
        <div className="form">
          <Section title="Hub-бот" description="Бот, через який працюють воронки, розсилки й доступ до каналів." actions={<Pill tone={hasToken ? (url ? "good" : "warn") : "crit"}>{!hasToken ? "токен не заданий" : url ? "працює" : "вебхук не встановлено"}</Pill>}>
            <KV items={[{ k: "Username", v: hub?.username ? "@" + hub.username : "—", mono: true }, { k: "Адреса вебхука", v: url || `${appUrl()}/api/telegram/hub`, mono: true }, { k: "Очікують апдейтів", v: (info as { pending_update_count?: number })?.pending_update_count ?? "—", mono: true }, { k: "Остання помилка", v: (info as { last_error_message?: string })?.last_error_message ?? "немає", mono: true }, { k: "Встановлено", v: dateTime(hub?.webhookSetAt), mono: true }]} />
            <div className="row-actions" style={{ marginTop: 12 }}>{hasToken ? <form action={setupWebhook}><button className="btn" type="submit"><RefreshCw size={15} /> {url ? "Переустановити вебхук" : "Увімкнути бота"}</button></form> : <Alert tone="warn">Додайте TELEGRAM_BOT_TOKEN у Vercel і зробіть редеплой.</Alert>}</div>
          </Section>
          <Section title="Зовнішні боти" description="«Щиро» та інші боти на своїх серверах перевіряють доступ через API Hub." >
            {ext.map((b) => <Row key={b.id} tone={b.isActive ? (b.lastSeenAt && Date.now() - b.lastSeenAt.getTime() < 3600000 ? "on" : "warn") : "off"} title={<>{b.name} <span className="mono muted">{b.username ? "@" + b.username : ""}</span></>} sub={`право ${b.resourceKey ?? "—"} · ключ ${b.apiKeyPrefix ?? "—"}… · останній запит ${dateTime(b.lastSeenAt)} · сьогодні ${b.requestsToday} запитів`}
              right={<Kebab><MenuAction action={rotateBotKey} fields={{ key: b.key }} icon={<KeyRound />} confirm="Видати новий ключ? Старий перестане працювати одразу.">Новий API-ключ</MenuAction><MenuAction action={toggleBot} fields={{ key: b.key, on: b.isActive ? "0" : "1" }} icon={<Power />}>{b.isActive ? "Вимкнути" : "Увімкнути"}</MenuAction></Kebab>} />)}
            {!ext.length && <EmptyState icon={<Bot size={20} />} title="Зовнішніх ботів ще немає" text="Створіть запис для «Щиро» нижче й передайте ключ інженеру." />}
            <form action={createExternalBot} style={{ marginTop: 14, borderTop: "1px solid var(--line)", paddingTop: 14 }}>
              <FormRow><Field label="Назва"><input name="name" placeholder="Щиро" required /></Field><Field label="Код" hint="латиницею"><input name="key" placeholder="shchyro" required /></Field></FormRow>
              <FormRow><Field label="Username бота"><input name="username" placeholder="ShchyroBot" /></Field><Field label="Яке право перевіряє"><select name="resourceKey">{res.filter((r) => r.kind === "bot_feature" || r.kind === "external_url").map((r) => <option key={r.key} value={r.key}>{r.name}</option>)}</select></Field></FormRow>
              <div className="row-actions" style={{ marginTop: 12 }}><button className="btn pri" type="submit"><KeyRound size={15} /> Створити і видати API-ключ</button><span className="fld-h">Адреса API: {base}/api/v1/access</span></div>
            </form>
          </Section>
        </div>
        <div className="form">
          <Section title="Команди Hub-бота">
            <Row title="/start" sub="вітання; впізнає учасницю за telegram id, запускає воронки з прямим доступом" />
            <Row title="/subscriptions" sub="мої підписки: ціна, статус, наступне списання" />
            <Row title="/plans" sub="оффери Hub з розділу «Оффери» (позначені «показувати в боті»)" />
            <Row tone="warn" title="Будь-яке повідомлення" sub="потрапляє в «Чати»; відповідь з панелі" />
          </Section>
          <Section title="Бот ZenEdu" description="Лишається як є; Hub-бот працює паралельно на своєму токені.">
            {zen.map((b) => <KV key={b.id} items={[{ k: "Назва", v: b.name }, { k: "Username", v: "@" + b.username, mono: true }, { k: "Стан", v: b.isActive ? "активний" : "зупинений" }]} />)}
            {!zen.length && <p className="fld-h">З’явиться після імпорту.</p>}
          </Section>
        </div>
      </div>
    </Shell>
  );
}
