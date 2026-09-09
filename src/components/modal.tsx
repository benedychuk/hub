"use client";
import { useRef, useState } from "react";

/** Модальне вікно на нативному <dialog>: кнопка-тригер і вміст, який рендерить сервер. */
export function Modal({ trigger, title, children, width = 560 }: { trigger: React.ReactNode; title: string; children: React.ReactNode; width?: number }) {
  const ref = useRef<HTMLDialogElement>(null);
  return (
    <>
      <span onClick={() => ref.current?.showModal()} style={{ display: "inline-flex" }}>{trigger}</span>
      <dialog ref={ref} className="modal" style={{ width: `min(${width}px, 94vw)` }} onClick={(e) => { if (e.target === ref.current) ref.current?.close(); }}>
        <div className="modal-in">
          <div className="modal-h"><h3>{title}</h3><button type="button" className="btn sm ghost" onClick={() => ref.current?.close()} aria-label="Закрити">✕</button></div>
          {children}
        </div>
      </dialog>
    </>
  );
}

type Chat = { id: number; title: string; type: string };
/** Підключення каналу або групи: крок 1 тип, крок 2 інструкція і список чатів, де бот уже адміністратор. */
export function ConnectChatDialog({ chats, botUsername, action }: { chats: Chat[]; botUsername: string | null; action: (fd: FormData) => void | Promise<void> }) {
  const ref = useRef<HTMLDialogElement>(null);
  const [kind, setKind] = useState<"channel" | "group" | null>(null);
  const [step, setStep] = useState<1 | 2>(1);
  const [manual, setManual] = useState(false);
  const list = chats.filter((c) => (kind === "channel" ? c.type === "channel" : c.type !== "channel"));
  const close = () => { ref.current?.close(); setStep(1); setKind(null); setManual(false); };
  return (
    <>
      <button type="button" className="btn pri" onClick={() => ref.current?.showModal()}>+ Підключити канал або групу{chats.length ? <span className="cnt" style={{ marginLeft: 8, background: "rgba(255,255,255,.25)", color: "#fff" }}>{chats.length}</span> : null}</button>
      <dialog ref={ref} className="modal" style={{ width: "min(600px, 94vw)" }} onClick={(e) => { if (e.target === ref.current) close(); }}>
        <div className="modal-in">
          <div className="modal-h"><h3>{step === 1 ? "Підключити канал або групу" : kind === "channel" ? "Підключити канал" : "Підключити групу"}</h3><button type="button" className="btn sm ghost" onClick={close} aria-label="Закрити">✕</button></div>
          {step === 1 && <>
            <div className="opts">
              <button type="button" className={`opt ${kind === "channel" ? "on" : ""}`} onClick={() => setKind("channel")}><span className="steptype">📣</span><b>Канал</b><small>закритий канал із постами</small></button>
              <button type="button" className={`opt ${kind === "group" ? "on" : ""}`} onClick={() => setKind("group")}><span className="steptype">👥</span><b>Група</b><small>чат, де пишуть учасниці</small></button>
            </div>
            <div className="modal-f"><button type="button" className="btn ghost" onClick={close}>Скасувати</button><button type="button" className="btn pri" disabled={!kind} onClick={() => setStep(2)}>Далі</button></div>
          </>}
          {step === 2 && <>
            <ol className="steps-how">
              <li>Відкрийте {kind === "channel" ? "канал" : "групу"} в Telegram → Адміністратори → Додати адміністратора → <b>@{botUsername ?? "hub-бот"}</b>.</li>
              <li>Увімкніть права <b>«Додавати учасників»</b> і <b>«Блокувати користувачів»</b>{kind === "channel" ? " (для каналу ще «Запрошувати за посиланням»)" : ""}.</li>
              <li>Оберіть чат нижче: він з’являється тут автоматично, щойно бот стає адміністратором.</li>
            </ol>
            <div className="chatlist">
              {list.map((c) => <form key={c.id} action={action} className="chatrow"><input type="hidden" name="chatId" value={c.id} /><span className="steptype">{c.type === "channel" ? "📣" : "👥"}</span><span className="grow"><b>{c.title}</b><small className="mono muted">{c.type} · {c.id}</small></span><button type="submit" className="btn sm pri">Підключити</button></form>)}
              {!list.length && <div className="muted" style={{ padding: "10px 0" }}>Поки не бачу {kind === "channel" ? "каналів" : "груп"}, де бот адміністратор. Виконайте кроки вище й <button type="button" className="lnk" style={{ fontSize: 13 }} onClick={() => location.reload()}>оновіть сторінку</button>.</div>}
            </div>
            {!manual ? <button type="button" className="lnk" style={{ fontSize: 13, marginTop: 8 }} onClick={() => setManual(true)}>Ввести chat_id вручну</button> : (
              <form action={action} className="chatrow" style={{ marginTop: 8 }}><input name="chatId" placeholder="-1001234567890" className="btn sm grow" required /><button type="submit" className="btn sm">Підключити</button></form>
            )}
            <div className="modal-f"><button type="button" className="btn ghost" onClick={() => setStep(1)}>← Назад</button><button type="button" className="btn ghost" onClick={close}>Закрити</button></div>
          </>}
        </div>
      </dialog>
    </>
  );
}
