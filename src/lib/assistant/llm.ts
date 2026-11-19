/**
 * Виклик моделі через OpenRouter (OpenAI-сумісний API), як у бота коментарів. Ключ — OPENROUTER_API_KEY у Vercel.
 * Повтор при збоях мережі й 429/5xx (до 3 спроб), таймаут 25 с на спробу.
 */
export type ChatMsg =
  | { role: "system" | "user"; content: string }
  | { role: "assistant"; content: string | null; tool_calls?: ToolCall[] }
  | { role: "tool"; tool_call_id: string; content: string };
export type ToolCall = { id: string; type: "function"; function: { name: string; arguments: string } };
export type ToolDef = { type: "function"; function: { name: string; description: string; parameters: Record<string, unknown> } };

export const llmConfigured = () => Boolean(process.env.OPENROUTER_API_KEY);
const BASE = () => (process.env.OPENROUTER_BASE_URL ?? "https://openrouter.ai/api/v1").replace(/\/$/, "");

export async function chat(model: string, messages: ChatMsg[], tools: ToolDef[]) {
  if (!process.env.OPENROUTER_API_KEY) throw new Error("OPENROUTER_API_KEY не задано");
  let last: unknown;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const r = await fetch(`${BASE()}/chat/completions`, {
        method: "POST",
        headers: { authorization: `Bearer ${process.env.OPENROUTER_API_KEY}`, "content-type": "application/json", "x-title": "Hub assistant" },
        body: JSON.stringify({ model, messages, tools: tools.length ? tools : undefined, tool_choice: tools.length ? "auto" : undefined, temperature: 0.3, max_tokens: 800 }),
        signal: AbortSignal.timeout(25_000),
      });
      if (r.status === 429 || r.status >= 500) { last = new Error(`OpenRouter ${r.status}`); await new Promise((res) => setTimeout(res, 1000 * 2 ** attempt)); continue; }
      const j = await r.json() as { choices?: { message?: { content?: string | null; tool_calls?: ToolCall[] } }[]; usage?: { prompt_tokens?: number; completion_tokens?: number }; error?: { message?: string } };
      if (!r.ok || j.error) throw new Error(`OpenRouter ${r.status}: ${j.error?.message ?? "помилка"}`);
      const m = j.choices?.[0]?.message ?? {};
      return { content: m.content ?? null, toolCalls: m.tool_calls ?? [], usage: { input: j.usage?.prompt_tokens ?? 0, output: j.usage?.completion_tokens ?? 0 } };
    } catch (e) {
      last = e;
      if (e instanceof Error && e.message.startsWith("OpenRouter 4")) throw e; // помилка запиту (ключ, модель) — повтор не допоможе
      await new Promise((res) => setTimeout(res, 1000 * 2 ** attempt));
    }
  }
  throw last instanceof Error ? last : new Error(String(last));
}

/** Чистка тексту за правилами тону (як редактор бота коментарів, але без другого запиту до моделі). */
export function polish(text: string) {
  return text
    .replace(/\*\*(.+?)\*\*/g, "$1").replace(/__(.+?)__/g, "$1")
    .replace(/[«»„“”"]/g, "")
    .replace(/\s?[—–]\s?/g, " - ")
    .replace(/^\s*[-•*]\s+/gm, "")
    .replace(/^\s*\d+[.)]\s+/gm, "")
    .replace(/https?:\/\/\S+/g, "") // посилання — лише кнопками з інструментів, щоб модель не вигадала адресу
    .replace(/[ \t]{2,}/g, " ").replace(/[ \t]*[-:][ \t]*$/gm, "").replace(/\n{3,}/g, "\n\n").trim();
}
