import { Trash2, Image as ImageIcon, FileText } from "lucide-react";
import Shell from "@/components/shell";
import { adminTelegramId } from "@/lib/auth";
import { Pill } from "@/components/ui";
import { Section, Alert, EmptyState } from "@/components/ui/layout";
import { Kebab, MenuAction } from "@/components/ui/controls";
import { navCounts, mediaList, adminTexts, recentSenders } from "@/lib/queries";
import { deleteMedia, renameMedia } from "@/lib/actions";
import { dateTime } from "@/lib/format";

export const dynamic = "force-dynamic";
const LABEL: Record<string, string> = { video_note: "кружечок", photo: "фото", video: "відео", animation: "GIF", voice: "голосове", audio: "аудіо", document: "файл", sticker: "стікер" };

export default async function Library() {
  const [counts, med, texts, senders] = await Promise.all([navCounts(), mediaList(), adminTexts(), recentSenders()]);
  const adminId = String(adminTelegramId() || "");
  const adminWrote = senders.some((x) => String(x.tg) === adminId);
  return (
    <Shell title="Бібліотека" counts={counts}>
      <Alert tone="info">Усе, що ви надсилаєте або пересилаєте в Hub-бот з акаунта адміністратора, потрапляє сюди: медіа для кроків воронок і розсилок, тексти для копіювання. Кнопки під пересланими повідомленнями Telegram не передає, їх треба відтворити в редакторі.</Alert>
      {!adminWrote && senders.length > 0 && <Alert tone="bad">У змінній ADMIN_TELEGRAM_ID зараз «{adminId || "порожньо"}», але з цього акаунта в бот ніхто не писав. Останні відправники: {senders.map((x) => `${x.first_name ?? ""}${x.username ? " @" + x.username : ""} (id ${x.tg})`).join(", ")}. Впишіть свій id у Vercel → Environment Variables → ADMIN_TELEGRAM_ID, зробіть Redeploy і перешліть медіа ще раз.</Alert>}
      <div className="grid g12">
        <Section title="Медіа" description={`${med.length} файлів`} className="tbl">
          <table><thead><tr><th>#</th><th>Тип</th><th>Назва</th><th>Параметри</th><th>Додано</th><th></th></tr></thead><tbody>
            {med.map((m) => <tr key={m.id}><td className="mono">#{m.id}</td><td><Pill tone={m.kind === "video_note" ? "acc" : "moon"}>{LABEL[m.kind] ?? m.kind}</Pill></td>
              <td><form action={renameMedia} className="row-actions" style={{ flexWrap: "nowrap" }}><input type="hidden" name="id" value={m.id} /><input name="title" defaultValue={m.title ?? m.caption?.slice(0, 40) ?? ""} placeholder="назва для себе" className="input" style={{ height: 30, width: 200, fontSize: 12.5 }} /><button className="btn sm ghost" type="submit">Зберегти</button></form></td>
              <td className="mono">{m.width ? `${m.width}×${m.height}` : ""}{m.duration ? ` · ${m.duration} с` : ""}{m.fileSize ? ` · ${Math.round(m.fileSize / 1024)} КБ` : ""}{m.kind === "video_note" && m.width && m.width !== m.height ? " · не квадрат" : ""}</td>
              <td className="mono">{dateTime(m.createdAt)}</td><td><Kebab><MenuAction action={deleteMedia} fields={{ id: m.id }} icon={<Trash2 />} danger confirm="Видалити файл із бібліотеки? Кроки й розсилки, де він використаний, втратять вкладення.">Видалити</MenuAction></Kebab></td></tr>)}
            {!med.length && <tr><td colSpan={6}><EmptyState icon={<ImageIcon size={20} />} title="Порожньо" text="Перешліть у Hub-бот фото, відео або кружечок: файл з’явиться тут." /></td></tr>}
          </tbody></table>
        </Section>
        <Section title="Тексти, надіслані в бот" description={`${texts.length} останніх`}>
          {texts.map((t) => <div key={t.id} style={{ borderBottom: "1px solid var(--line)", padding: "10px 0" }}><div className="fld-h mono">{dateTime(t.at)}{t.media ? ` · підпис до ${LABEL[t.media] ?? t.media}` : ""}</div><div style={{ whiteSpace: "pre-wrap", fontSize: 13.5, userSelect: "all" }}>{t.text}</div></div>)}
          {!texts.length && <EmptyState icon={<FileText size={20} />} title="Ще нічого" />}
        </Section>
      </div>
    </Shell>
  );
}
