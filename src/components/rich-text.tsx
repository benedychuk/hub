"use client";
import { useEffect, useMemo, useRef, useState } from "react";

/* ---------- Telegram HTML ⇄ DOM редактора ---------- */
const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
/** DOM редактора → HTML, який приймає Telegram (b i u s a code pre tg-spoiler blockquote). */
function serialize(root: Node): string {
  let out = "";
  const walk = (n: Node, last: boolean) => {
    if (n.nodeType === Node.TEXT_NODE) { out += esc(n.textContent ?? ""); return; }
    if (n.nodeType !== Node.ELEMENT_NODE) return;
    const el = n as HTMLElement; const tag = el.tagName.toLowerCase(); const st = el.style;
    if (tag === "br") { out += "\n"; return; }
    const kids = () => { const c = Array.from(el.childNodes); c.forEach((k, i) => walk(k, i === c.length - 1)); };
    const wrapWith = (open: string, close: string) => { out += open; kids(); out += close; };
    if (tag === "b" || tag === "strong" || st.fontWeight === "bold" || Number(st.fontWeight) >= 600) return wrapWith("<b>", "</b>");
    if (tag === "i" || tag === "em" || st.fontStyle === "italic") return wrapWith("<i>", "</i>");
    if (tag === "u" || st.textDecoration.includes("underline")) return wrapWith("<u>", "</u>");
    if (tag === "s" || tag === "strike" || tag === "del" || st.textDecoration.includes("line-through")) return wrapWith("<s>", "</s>");
    if (tag === "a" && el.getAttribute("href")) return wrapWith(`<a href="${esc(el.getAttribute("href")!)}">`, "</a>");
    if (tag === "code") return wrapWith("<code>", "</code>");
    if (tag === "pre") return wrapWith("<pre>", "</pre>");
    if (tag === "tg-spoiler" || el.classList.contains("spoiler")) return wrapWith("<tg-spoiler>", "</tg-spoiler>");
    if (tag === "blockquote") { wrapWith("<blockquote>", "</blockquote>"); if (!last) out += "\n"; return; }
    if (tag === "div" || tag === "p" || tag === "li") { kids(); if (!last && !out.endsWith("\n")) out += "\n"; return; }
    kids();
  };
  Array.from(root.childNodes).forEach((k, i, a) => walk(k, i === a.length - 1));
  return out.replace(/ /g, " ").replace(/\n{3,}$/g, "\n\n");
}
/** HTML Telegram → розмітка для contenteditable. */
function toEditor(html: string) {
  return html.replace(/<\/blockquote>\n/g, "</blockquote>").replace(/<\/pre>\n/g, "</pre>").replace(/<tg-spoiler>/g, '<span class="spoiler">').replace(/<\/tg-spoiler>/g, "</span>").replace(/<span class="tg-spoiler">/g, '<span class="spoiler">').replace(/\n/g, "<br>");
}
const textLength = (root: HTMLElement) => (root.innerText ?? "").replace(/\n$/, "").length;

const I = {
  link: <svg viewBox="0 0 24 24"><path d="M10 14a5 5 0 0 0 7 0l3-3a5 5 0 0 0-7-7l-1 1" /><path d="M14 10a5 5 0 0 0-7 0l-3 3a5 5 0 0 0 7 7l1-1" /></svg>,
  spoiler: <svg viewBox="0 0 24 24"><path d="M3 3l18 18" /><path d="M10.6 10.6a2 2 0 0 0 2.8 2.8" /><path d="M9.9 5.1A10 10 0 0 1 12 5c5 0 9 4 10 7-.4 1-1.2 2.3-2.4 3.5M6.6 6.6C4.5 8 3 10 2 12c1 3 5 7 10 7 1.6 0 3-.4 4.3-1" /></svg>,
  quote: <svg viewBox="0 0 24 24"><path d="M7 7h4v4H7zM13 7h4v4h-4z" /><path d="M11 11c0 3-1 4-4 5M17 11c0 3-1 4-4 5" /></svg>,
  clear: <svg viewBox="0 0 24 24"><path d="M4 20h9" /><path d="m6 15 8-8 4 4-8 8H6z" /><path d="M14 7l3-3 4 4-3 3" /></svg>,
  code: <svg viewBox="0 0 24 24"><path d="m8 8-4 4 4 4M16 8l4 4-4 4M14 5l-4 14" /></svg>,
  var: <svg viewBox="0 0 24 24"><path d="M8 4c-2 0-3 1-3 3v3c0 1-1 2-2 2 1 0 2 1 2 2v3c0 2 1 3 3 3M16 4c2 0 3 1 3 3v3c0 1 1 2 2 2-1 0-2 1-2 2v3c0 2-1 3-3 3" /></svg>,
};

/** Візуальний редактор тексту для Telegram: форматування видно одразу, у форму йде HTML із тегами Telegram. */
export function RichText({ name, defaultValue, max = 4096, minHeight = 180, placeholder = "Текст повідомлення…", variables }: { name: string; defaultValue: string; max?: number; minHeight?: number; placeholder?: string; variables?: { key: string; label: string }[] }) {
  const ed = useRef<HTMLDivElement>(null);
  const [html, setHtml] = useState(defaultValue);
  const [len, setLen] = useState(0);
  const [showVars, setShowVars] = useState(false);
  const initial = useMemo(() => toEditor(defaultValue), [defaultValue]);
  useEffect(() => { if (ed.current) setLen(textLength(ed.current)); }, []);
  const emit = () => { if (!ed.current) return; setHtml(serialize(ed.current)); setLen(textLength(ed.current)); };
  const cmd = (c: string, v?: string) => { ed.current?.focus(); document.execCommand(c, false, v); emit(); };
  const selectionIn = (tag: string, cls?: string) => {
    const sel = window.getSelection(); if (!sel?.rangeCount) return null;
    let n: Node | null = sel.getRangeAt(0).commonAncestorContainer;
    while (n && n !== ed.current) { if (n.nodeType === 1) { const e = n as HTMLElement; if (e.tagName.toLowerCase() === tag && (!cls || e.classList.contains(cls))) return e; } n = n.parentNode; }
    return null;
  };
  const wrap = (tag: string, cls?: string) => {
    ed.current?.focus();
    const existing = selectionIn(tag, cls);
    if (existing) { const p = existing.parentNode!; while (existing.firstChild) p.insertBefore(existing.firstChild, existing); p.removeChild(existing); emit(); return; }
    const sel = window.getSelection(); if (!sel?.rangeCount) return;
    const r = sel.getRangeAt(0); if (r.collapsed) return;
    const el = document.createElement(tag); if (cls) el.className = cls;
    try { r.surroundContents(el); } catch { el.appendChild(r.extractContents()); r.insertNode(el); }
    sel.removeAllRanges(); const nr = document.createRange(); nr.selectNodeContents(el); sel.addRange(nr); emit();
  };
  const link = () => {
    ed.current?.focus();
    const a = selectionIn("a"); if (a) { cmd("unlink"); return; }
    const sel = window.getSelection(); const hasSel = sel && sel.rangeCount && !sel.getRangeAt(0).collapsed;
    const url = window.prompt("Адреса посилання", "https://"); if (!url || url === "https://") return;
    if (hasSel) cmd("createLink", url); else cmd("insertHTML", `<a href="${esc(url)}">${esc(url)}</a>`);
  };
  const insertVar = (k: string) => { ed.current?.focus(); document.execCommand("insertText", false, `{${k}}`); emit(); setShowVars(false); };
  const B = ({ t, title, onClick, icon, cls }: { t?: string; title: string; onClick: () => void; icon?: React.ReactNode; cls?: string }) => <button type="button" className={`rte-b ${cls ?? ""}`} title={title} onMouseDown={(e) => e.preventDefault()} onClick={onClick}>{icon ?? t}</button>;
  return (
    <div className="rte">
      <input type="hidden" name={name} value={html} />
      <div className="rte-bar">
        <B t="B" title="Жирний (Ctrl+B)" cls="b" onClick={() => cmd("bold")} />
        <B t="I" title="Курсив (Ctrl+I)" cls="i" onClick={() => cmd("italic")} />
        <B t="U" title="Підкреслений (Ctrl+U)" cls="u" onClick={() => cmd("underline")} />
        <B t="S" title="Закреслений" cls="s" onClick={() => cmd("strikeThrough")} />
        <span className="rte-sep" />
        <B title="Посилання" icon={I.link} onClick={link} />
        <B title="Моноширинний" icon={I.code} onClick={() => wrap("code")} />
        <B title="Спойлер" icon={I.spoiler} onClick={() => wrap("span", "spoiler")} />
        <B title="Цитата" icon={I.quote} onClick={() => { const q = selectionIn("blockquote"); if (q) cmd("formatBlock", "div"); else cmd("formatBlock", "blockquote"); }} />
        <span className="rte-sep" />
        <B title="Прибрати форматування" icon={I.clear} onClick={() => { cmd("removeFormat"); cmd("unlink"); }} />
        {variables?.length ? <span style={{ position: "relative" }}><B title="Вставити змінну" icon={I.var} onClick={() => setShowVars((v) => !v)} />{showVars && <div className="dd" style={{ left: 0, right: "auto", top: 34, position: "absolute", zIndex: 30 }}>{variables.map((v) => <button key={v.key} type="button" onMouseDown={(e) => e.preventDefault()} onClick={() => insertVar(v.key)}><code style={{ fontSize: 12 }}>{`{${v.key}}`}</code><span className="muted" style={{ fontSize: 12 }}>{v.label}</span></button>)}</div>}</span> : null}
        <span className={`rte-cnt ${len > max ? "over" : ""}`}>{len} / {max}</span>
      </div>
      <div ref={ed} className="rte-ed" contentEditable suppressContentEditableWarning data-placeholder={placeholder} style={{ minHeight }} dangerouslySetInnerHTML={{ __html: initial }}
        onInput={emit} onBlur={emit}
        onPaste={(e) => { e.preventDefault(); document.execCommand("insertText", false, e.clipboardData.getData("text/plain")); emit(); }}
        onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); document.execCommand("insertLineBreak"); emit(); } }} />
    </div>
  );
}
