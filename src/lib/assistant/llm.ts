/**
 * Виклик моделі через OpenRouter (OpenAI-сумісний API), як у бота коментарів. Ключ — OPENROUTER_API_KEY у Vercel.
 * Повтор при збоях мережі й 429/5xx (до 3 спроб), таймаут 25 с на спробу.
 */
export type ChatMsg =
  | { role: "system" | "user"; content: string }
  | { role: "assistant"; content: string | null; tool_calls?: ToolCall[]; reasoning_details?: unknown[] }
  | { role: "tool"; tool_call_id: string; content: string };
export type ToolCall = { id: string; type: "function"; function: { name: string; arguments: string } };
export type ToolDef = { type: "function"; function: { name: string; description: string; parameters: Record<string, unknown> } };

export const llmConfigured = () => Boolean(process.env.OPENROUTER_API_KEY);
const BASE = () => (process.env.OPENROUTER_BASE_URL ?? "https://openrouter.ai/api/v1").replace(/\/$/, "");

/**
 * maxTokens — ліміт на всю відповідь моделі РАЗОМ із її міркуваннями (Gemini 3 спершу «думає»): 800 було замало,
 * і текст обрізався посеред слова. reasoning.effort = low — коротші міркування (швидше й дешевше).
 */
export async function chat(model: string, messages: ChatMsg[], tools: ToolDef[], maxTokens = 4000) {
  if (!process.env.OPENROUTER_API_KEY) throw new Error("OPENROUTER_API_KEY не задано");
  let last: unknown;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const r = await fetch(`${BASE()}/chat/completions`, {
        method: "POST",
        headers: { authorization: `Bearer ${process.env.OPENROUTER_API_KEY}`, "content-type": "application/json", "x-title": "Hub assistant" },
        body: JSON.stringify({ model, messages, tools: tools.length ? tools : undefined, tool_choice: tools.length ? "auto" : undefined, temperature: 0.3, max_tokens: maxTokens, reasoning: { effort: "low" } }),
        signal: AbortSignal.timeout(25_000),
      });
      if (r.status === 429 || r.status >= 500) { last = new Error(`OpenRouter ${r.status}`); await new Promise((res) => setTimeout(res, 1000 * 2 ** attempt)); continue; }
      type Err = { message?: string; code?: number | string; metadata?: { raw?: unknown; provider_name?: string } };
      const j = await r.json().catch(() => ({})) as { choices?: { finish_reason?: string; native_finish_reason?: string; message?: { content?: string | null; tool_calls?: ToolCall[]; reasoning_details?: unknown[] }; error?: Err }[]; usage?: { prompt_tokens?: number; completion_tokens?: number }; error?: Err };
      // OpenRouter інколи повертає помилку провайдера з кодом 200 або всередині choices — показуємо справжню причину
      const err = j.error ?? j.choices?.[0]?.error;
      if (!r.ok || err) {
        const raw = err?.metadata?.raw ? ` · ${typeof err.metadata.raw === "string" ? err.metadata.raw : JSON.stringify(err.metadata.raw)}` : "";
        throw new Error(`OpenRouter ${r.ok ? err?.code ?? 400 : r.status}: ${err?.message ?? "помилка"}${raw}`.slice(0, 500));
      }
      const m = j.choices?.[0]?.message ?? {};
      // reasoning_details (підпис міркувань Gemini 3) треба повернути в наступному запиті разом із викликом інструмента,
      // інакше модель відповідає помилкою після будь-якої дії асистентки
      // finish_reason = length — відповідь обрізано лімітом: такий текст людині не надсилаємо
      const finish = j.choices?.[0]?.finish_reason ?? null;
      return { content: m.content ?? null, toolCalls: m.tool_calls ?? [], reasoningDetails: m.reasoning_details, truncated: finish === "length" || /MAX_TOKENS/i.test(String(j.choices?.[0]?.native_finish_reason ?? "")), usage: { input: j.usage?.prompt_tokens ?? 0, output: j.usage?.completion_tokens ?? 0 } };
    } catch (e) {
      last = e;
      if (e instanceof Error && e.message.startsWith("OpenRouter 4")) throw e; // помилка запиту (ключ, модель) — повтор не допоможе
      await new Promise((res) => setTimeout(res, 1000 * 2 ** attempt));
    }
  }
  throw last instanceof Error ? last : new Error(String(last));
}

const isEmoji = (g: string) => /\p{Extended_Pictographic}/u.test(g);
/** Не більше max смайликів на повідомлення (зайві прибираються з кінця тексту); max = 0 — без смайликів. */
export function limitEmoji(text: string, max = 2) {
  const seg = new Intl.Segmenter("uk", { granularity: "grapheme" });
  let n = 0; let out = "";
  for (const { segment } of seg.segment(text)) {
    if (isEmoji(segment)) { n++; if (n > max) continue; }
    out += segment;
  }
  return out.replace(/[ \t]{2,}/g, " ").replace(/[ \t]+([.,!?;:])/g, "$1").replace(/[ \t]+$/gm, "");
}
/** Без крапки в кінці абзацу (звучить різко): «текст.» → «текст», «текст. 🤍» → «текст 🤍». Три крапки й ?! лишаються. */
export function dropFinalDots(text: string) {
  return text.split("\n").map((line) => {
    const m = line.match(/^(.*?)([\s\p{Extended_Pictographic}\uFE0F\u200D\u2640\u2642]*)$/u);
    if (!m) return line;
    let body = m[1]; const tail = m[2];
    if (/[^.]\.$/.test(body) || body === ".") body = body.slice(0, -1).trimEnd();
    return body + (tail.trim() ? " " + tail.trim() : "");
  }).join("\n");
}

/** Запасний захист: якщо текст усе ж обірвано, лишаємо його до кінця останнього повного речення. */
export function trimToSentence(text: string) {
  const t = text.trimEnd();
  const i = Math.max(t.lastIndexOf(". "), t.lastIndexOf("! "), t.lastIndexOf("? "), t.lastIndexOf(".\n"), t.lastIndexOf("!\n"), t.lastIndexOf("?\n"));
  return i > 0 ? t.slice(0, i + 1).trimEnd() : "";
}

/** Чистка тексту за правилами тону (як редактор бота коментарів, але без другого запиту до моделі). */
export function polish(text: string, opts: { maxEmoji?: number } = {}) {
  return dropFinalDots(limitEmoji(polishRaw(text), opts.maxEmoji ?? 2));
}
function polishRaw(text: string) {
  return text
    .replace(/\*\*(.+?)\*\*/g, "$1").replace(/__(.+?)__/g, "$1")
    .replace(/[«»„“”"]/g, "")
    .replace(/\s?[—–]\s?/g, " - ")
    .replace(/^\s*[-•*]\s+/gm, "")
    .replace(/^\s*\d+[.)]\s+/gm, "")
    .replace(/https?:\/\/\S+/g, "") // посилання — лише кнопками з інструментів, щоб модель не вигадала адресу
    .replace(/[ \t]{2,}/g, " ").replace(/[ \t]*[-:][ \t]*$/gm, "").replace(/\n{3,}/g, "\n\n").trim();
}
