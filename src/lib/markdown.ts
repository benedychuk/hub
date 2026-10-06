/**
 * Мінімальний безпечний Markdown → HTML для звітів аналітики «Щиро».
 * Увесь текст екранується, тому розмітка з моделі не виконується як HTML.
 * Підтримує: заголовки, абзаци, списки, таблиці, цитати, код, hr, жирний, курсив, посилання.
 */
const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
function inline(s: string) {
  let t = esc(s);
  t = t.replace(/`([^`]+)`/g, (_m, c) => `<code>${c}</code>`);
  t = t.replace(/\*\*([^*]+)\*\*/g, "<b>$1</b>").replace(/__([^_]+)__/g, "<b>$1</b>");
  t = t.replace(/(^|[^*])\*([^*\n]+)\*/g, "$1<i>$2</i>").replace(/(^|[^_])_([^_\n]+)_/g, "$1<i>$2</i>");
  t = t.replace(/\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g, '<a href="$2" target="_blank" rel="noreferrer">$1</a>');
  return t;
}
export function markdownToHtml(md: string) {
  const lines = md.replace(/\r\n?/g, "\n").split("\n");
  const out: string[] = []; let i = 0;
  const para: string[] = [];
  const flush = () => { if (para.length) { out.push(`<p>${inline(para.join(" "))}</p>`); para.length = 0; } };
  while (i < lines.length) {
    const l = lines[i];
    if (/^\s*$/.test(l)) { flush(); i++; continue; }
    if (/^```/.test(l)) { flush(); const buf: string[] = []; i++; while (i < lines.length && !/^```/.test(lines[i])) buf.push(lines[i++]); i++; out.push(`<pre><code>${esc(buf.join("\n"))}</code></pre>`); continue; }
    const h = l.match(/^(#{1,6})\s+(.*)$/); if (h) { flush(); const n = Math.min(6, h[1].length + 1); out.push(`<h${n}>${inline(h[2])}</h${n}>`); i++; continue; }
    if (/^\s*(-{3,}|\*{3,})\s*$/.test(l)) { flush(); out.push("<hr>"); i++; continue; }
    if (/^\s*\|.*\|\s*$/.test(l) && i + 1 < lines.length && /^\s*\|?\s*:?-{2,}/.test(lines[i + 1])) {
      flush(); const cells = (r: string) => r.trim().replace(/^\||\|$/g, "").split("|").map((c) => c.trim());
      const head = cells(l); i += 2; const rows: string[][] = [];
      while (i < lines.length && /^\s*\|.*\|\s*$/.test(lines[i])) rows.push(cells(lines[i++]));
      const num = (c: string) => /^[\d\s.,%▇]+$/.test(c) && /\d/.test(c);
      out.push(`<table><thead><tr>${head.map((c) => `<th>${inline(c)}</th>`).join("")}</tr></thead><tbody>${rows.map((r) => `<tr>${r.map((c) => `<td${num(c) ? ' class="num"' : ""}>${inline(c)}</td>`).join("")}</tr>`).join("")}</tbody></table>`);
      continue;
    }
    if (/^\s*>\s?/.test(l)) { flush(); const buf: string[] = []; while (i < lines.length && /^\s*>\s?/.test(lines[i])) buf.push(lines[i++].replace(/^\s*>\s?/, "")); out.push(`<blockquote>${inline(buf.join(" "))}</blockquote>`); continue; }
    if (/^\s*[-*•]\s+/.test(l)) { flush(); const buf: string[] = []; while (i < lines.length && /^\s*[-*•]\s+/.test(lines[i])) buf.push(lines[i++].replace(/^\s*[-*•]\s+/, "")); out.push(`<ul>${buf.map((x) => `<li>${inline(x)}</li>`).join("")}</ul>`); continue; }
    if (/^\s*\d+[.)]\s+/.test(l)) { flush(); const buf: string[] = []; while (i < lines.length && /^\s*\d+[.)]\s+/.test(lines[i])) buf.push(lines[i++].replace(/^\s*\d+[.)]\s+/, "")); out.push(`<ol>${buf.map((x) => `<li>${inline(x)}</li>`).join("")}</ol>`); continue; }
    para.push(l.trim()); i++;
  }
  flush();
  return out.join("\n");
}
