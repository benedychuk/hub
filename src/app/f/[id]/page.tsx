import { notFound } from "next/navigation";
import { funnelPublic } from "@/lib/queries";

export const dynamic = "force-dynamic";

/** Публічний лендінг воронки: обкладинка, опис і кнопка, що веде в бота з параметром f_<id>. */
export default async function FunnelLanding({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const d = await funnelPublic(Number(id));
  if (!d) notFound();
  const { f, botUsername } = d;
  const href = botUsername ? `https://t.me/${botUsername}?start=f_${f.id}` : "#";
  const desc = (f.description ?? "").replace(/<(?!\/?(b|i|u|s|a|code|br|p|em|strong)\b)[^>]*>/gi, "").replace(/\n/g, "<br/>");
  return (
    <div className="landing">
      <div className="card">
        {f.cover ? <div className="cover" style={{ backgroundImage: `url(${f.cover})` }} /> : <div className="cover" style={{ backgroundImage: "linear-gradient(135deg, rgba(238,108,41,.35), rgba(122,166,179,.45))" }} />}
        <div className="in">
          <h1>{f.name}</h1>
          {desc && <div className="desc" dangerouslySetInnerHTML={{ __html: desc }} />}
          {!f.isActive && <p className="muted">Воронка поки не активна.</p>}
          <a className="btn pri" href={href} style={{ justifyContent: "center", fontSize: 15, padding: "12px 18px" }}>{f.buttonText || "Отримати доступ"}</a>
          <p className="note" style={{ textAlign: "center" }}>Відкриється Telegram-бот{botUsername ? ` @${botUsername}` : ""}.</p>
        </div>
      </div>
    </div>
  );
}
