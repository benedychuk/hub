import Shell from "@/components/shell";
import { Pill } from "@/components/ui";
import { navCounts, mediaList, adminTexts, recentSenders } from "@/lib/queries";
import { deleteMedia, renameMedia } from "@/lib/actions";
import { dateTime } from "@/lib/format";

export const dynamic = "force-dynamic";
const LABEL: Record<string, string> = { video_note: "кружечок", photo: "фото", video: "відео", animation: "GIF", voice: "голосове", audio: "аудіо", document: "файл", sticker: "стікер" };

export default async function Library() {
  const [counts, med, texts, senders] = await Promise.all([navCounts(), mediaList(), adminTexts(), recentSenders()]);
  const adminId = String(process.env.ADMIN_TELEGRAM_ID ?? "").replace(/\D/g, "");
  const adminWrote = senders.some((x) => String(x.tg) === adminId);
  return (
    <Shell title="Бібліотека" counts={counts}>
      <div className="alert">Сюди потрапляє все, що ви надсилаєте або пересилаєте в Hub-бот з акаунта адміністратора: медіа з номером для кроків воронок і розсилок, тексти для копіювання. Кнопки під пересланими повідомленнями Telegram не передає, їх треба відтворити в редакторі кроку.</div>
      {!adminWrote && senders.length > 0 && <div className="alert bad">У змінній ADMIN_TELEGRAM_ID зараз «{adminId || "порожньо"}», але з цього акаунта в бот ніхто не писав. Останні відправники: {senders.map((x) => <span key={x.tg} className="mono" style={{ marginRight: 10 }}>{x.first_name ?? ""}{x.username ? " @" + x.username : ""} · id <b>{x.tg}</b> · {x.n} повідомл.{x.with_media ? ` · ${x.with_media} з медіа` : ""}</span>)}. Впишіть свій id у Vercel → Environment Variables → ADMIN_TELEGRAM_ID, зробіть Redeploy і перешліть медіа ще раз.</div>}
      {adminWrote && !med.length && <div className="alert">Ваш акаунт впізнано, але медіа ще не збережено. Перешліть файли ще раз: бот має відповісти «Збережено в бібліотеку медіа».</div>}
      <div className="grid g12">
        <div className="card tbl"><h3>Медіа <span className="sub">{med.length}</span></h3>
          <table><thead><tr><th>#</th><th>Тип</th><th>Назва</th><th>Розмір</th><th>Додано</th><th></th></tr></thead><tbody>
            {med.map((m) => <tr key={m.id}><td className="mono">#{m.id}</td><td><Pill tone={m.kind === "video_note" ? "acc" : "moon"}>{LABEL[m.kind] ?? m.kind}</Pill></td>
              <td><form action={renameMedia} className="row-actions"><input type="hidden" name="id" value={m.id} /><input name="title" defaultValue={m.title ?? m.caption?.slice(0, 40) ?? ""} placeholder="назва для себе" style={{ border: "1px solid var(--line-2)", borderRadius: 6, padding: "2px 6px", fontSize: 12.5, width: 180 }} /><button className="btn sm ghost" type="submit">ок</button></form></td>
              <td className="mono">{m.width ? `${m.width}×${m.height}` : ""}{m.duration ? ` · ${m.duration} с` : ""}{m.fileSize ? ` · ${Math.round(m.fileSize / 1024)} КБ` : ""}{m.kind === "video_note" && m.width && m.width !== m.height ? " · не квадрат" : ""}</td>
              <td className="mono">{dateTime(m.createdAt)}</td><td><form action={deleteMedia}><input type="hidden" name="id" value={m.id} /><button className="btn sm danger ghost" type="submit">✕</button></form></td></tr>)}
            {!med.length && <tr><td colSpan={6} className="muted">Порожньо. Перешліть у Hub-бот фото, відео або кружечок.</td></tr>}
          </tbody></table></div>
        <div className="card"><h3>Тексти, надіслані в бот <span className="sub">{texts.length}</span></h3>
          {texts.map((t) => <div key={t.id} style={{ borderBottom: "1px solid var(--line)", padding: "10px 0" }}><div className="mono muted" style={{ fontSize: 11.5 }}>{dateTime(t.at)}{t.media ? ` · підпис до ${LABEL[t.media] ?? t.media}` : ""}</div><div style={{ whiteSpace: "pre-wrap", fontSize: 13.5, userSelect: "all" }}>{t.text}</div></div>)}
          {!texts.length && <p className="muted">Ще нічого.</p>}
        </div>
      </div>
    </Shell>
  );
}
