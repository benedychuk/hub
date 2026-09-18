import Shell from "@/components/shell";
import { Alert, EmptyState, Toolbar } from "@/components/ui/layout";
import { LibraryGrid } from "@/components/library-ui";
import { navCounts, mediaList } from "@/lib/queries";
import { myTelegramId } from "@/lib/auth";
import { hasDb } from "@/db";
import { and, eq } from "drizzle-orm";
import { db, schema } from "@/db";

export const dynamic = "force-dynamic";

/** Бібліотека медіа: файли для кроків воронок, продуктів і розсилок. Джерела: завантаження з браузера і надсилання в Hub-бот. */
export default async function Library() {
  const [counts, med] = await Promise.all([navCounts(), mediaList()]);
  const tg = hasDb() ? await myTelegramId() : 0;
  const [me] = tg && hasDb() ? await db().select({ id: schema.persons.id }).from(schema.persons).where(eq(schema.persons.telegramUserId, tg)) : [];
  const [idn] = me ? await db().select({ chatId: schema.identities.chatId, blockedAt: schema.identities.blockedAt }).from(schema.identities).where(and(eq(schema.identities.personId, me.id), eq(schema.identities.botKey, "hub"))) : [];
  const botReady = Boolean(idn?.chatId && !idn.blockedAt);
  return (
    <Shell title="Бібліотека" counts={counts}>
      {!tg && <Alert tone="warn">Вкажіть свій Telegram ID у Налаштування → Мій акаунт: файли завантажуються через Hub-бот у ваш Telegram.</Alert>}
      {tg && !botReady && <Alert tone="warn">Натисніть /start у Hub-боті зі свого Telegram: без цього завантаження з браузера не працює. Файли, надіслані в бот, потрапляють сюди й так.</Alert>}
      <Toolbar><p className="fld-h" style={{ margin: 0 }}>Файли до 4 МБ завантажуйте тут; більші (довгі відео) надішліть у Hub-бот зі свого Telegram, і вони зʼявляться в бібліотеці. Далі файл вставляється у крок або розсилку через «Файл із бібліотеки».</p></Toolbar>
      {med.length ? <LibraryGrid media={med} /> : <div className="card"><EmptyState title="Бібліотека порожня" text="Завантажте перший файл або надішліть його в Hub-бот." action={<LibraryGrid media={[]} onlyUpload />} /></div>}
    </Shell>
  );
}
