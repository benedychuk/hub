"use client";
import Script from "next/script";
import { useCallback, useState } from "react";

type TG = { WebApp: { initData: string; ready: () => void; expand: () => void; openLink: (u: string) => void; close: () => void } };
declare global { interface Window { Telegram?: TG } }

/** Mini App етеру: Telegram передає підписані дані людини, Hub записує перехід і відкриває YouTube. */
export default function LiveClient() {
  const [state, setState] = useState<{ phase: "wait" | "go" | "soon" | "error" | "browser"; title?: string; url?: string | null; when?: string }>({ phase: "wait" });
  const start = useCallback(async () => {
    const wa = window.Telegram?.WebApp;
    if (!wa?.initData) { setState({ phase: "browser" }); return; }
    wa.ready(); wa.expand();
    try {
      const r = await fetch("/api/streams/visit", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ initData: wa.initData }) });
      const j = await r.json() as { ok: boolean; title?: string; url?: string | null; startsAt?: string };
      if (!j.ok) { setState({ phase: "error" }); return; }
      const when = j.startsAt ? new Date(j.startsAt).toLocaleString("uk-UA", { timeZone: "Europe/Kyiv", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" }) : "";
      if (!j.url) { setState({ phase: "soon", title: j.title, when }); return; }
      setState({ phase: "go", title: j.title, url: j.url, when });
      wa.openLink(j.url);
      setTimeout(() => wa.close(), 1500);
    } catch { setState({ phase: "error" }); }
  }, []);
  return (
    <div className="landing">
      <Script src="https://telegram.org/js/telegram-web-app.js" strategy="afterInteractive" onLoad={start} onError={() => setState({ phase: "browser" })} />
      <div className="card"><div className="in">
        <div className="brand" style={{ color: "var(--ink)", padding: 0 }}><i /><span>Hub</span> <small>клуб Марії</small></div>
        {state.phase === "wait" && <><h1>Відкриваємо етер…</h1><p className="desc">Зачекайте секунду.</p></>}
        {state.phase === "go" && <><h1>{state.title}</h1><p className="desc">{state.when ? `${state.when} · ` : ""}Трансляція відкривається. Якщо не відкрилась — натисніть кнопку.</p><a className="btn pri" href={state.url ?? "#"} target="_blank" rel="noreferrer" style={{ justifyContent: "center", padding: "12px 18px" }}>Дивитись етер</a></>}
        {state.phase === "soon" && <><h1>{state.title}</h1><p className="desc">{state.when ? `${state.when}. ` : ""}Посилання на трансляцію з'явиться ближче до початку. Відкрийте це посилання в каналі ще раз за кілька хвилин до етеру.</p></>}
        {state.phase === "error" && <><h1>Не вдалося відкрити етер</h1><p className="desc">Спробуйте ще раз з каналу клубу або напишіть нам у бот.</p></>}
        {state.phase === "browser" && <><h1>Відкрийте з Telegram</h1><p className="desc">Ця сторінка працює лише всередині Telegram: перейдіть за посиланням на етер у каналі клубу.</p></>}
      </div></div>
    </div>
  );
}
