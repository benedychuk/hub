// Клієнт публічного API ZenEdu. Ліміт 60 запитів/хв; Cloudflare блокує нестандартні User-Agent.
const BASE = "https://app.zenedu.io/api/v1";

export type ZenBot = { id: number; name: string; username: string; is_active: boolean; created_at: string };
export type ZenSubscriber = {
  id: number; user_id: number; first_name: string | null; last_name: string | null; username: string | null;
  phone: string | null; email: string | null; notes: string | null; tags: string; is_active: boolean; is_blocked: boolean;
  last_active_at: string | null; created_at: string; utm_tags: Record<string, string>[]; custom_fields: Record<string, unknown>[];
};
export type ZenOrder = {
  id: number; uuid: string; number: number; offer_id: number; offer_name: string; price: number; currency: string;
  type: "subscription_start" | "subscription_renew" | "one_time"; payment_system_type: string | null; payment_system_name: string | null;
  status: string; status_changed_at: string; created_at: string; subscriber?: ZenSubscriber;
};
export type ZenOffer = {
  id: number; name: string; price: number; currency: string; is_active: boolean; is_subscription: boolean; accesses_count: number;
  description: string | null; link?: string; landing_link?: string; created_at: string;
};
export type ZenFunnel = { id: number; name: string; is_active: boolean; subscribers_count: number; steps_count: number; created_at: string };

type Page<T> = { data: T[]; meta?: { current_page: number; last_page: number; total: number } };

function token() {
  const t = process.env.ZENEDU_API_TOKEN;
  if (!t) throw new Error("ZENEDU_API_TOKEN is not set");
  return t;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export async function zenGet<T>(path: string, params: Record<string, string | number> = {}): Promise<T> {
  const url = new URL(BASE + path);
  Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, String(v)));
  for (let attempt = 0; attempt < 5; attempt++) {
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${token()}`, Accept: "application/json", "User-Agent": "curl/8.5.0" },
      cache: "no-store",
    });
    if (res.ok) {
      const remaining = Number(res.headers.get("x-ratelimit-remaining") ?? 10);
      if (remaining < 3) await sleep(15000);
      return (await res.json()) as T;
    }
    if ([403, 429, 500, 502, 503].includes(res.status) && attempt < 4) { await sleep(8000 * (attempt + 1)); continue; }
    throw new Error(`ZenEdu ${res.status} on ${path}`);
  }
  throw new Error("ZenEdu: retries exhausted");
}

export async function zenPost<T>(path: string, form: Record<string, string | number>): Promise<T> {
  const body = new URLSearchParams();
  Object.entries(form).forEach(([k, v]) => body.set(k, String(v)));
  const res = await fetch(BASE + path, {
    method: "POST",
    headers: { Authorization: `Bearer ${token()}`, Accept: "application/json", "User-Agent": "curl/8.5.0" },
    body,
  });
  if (!res.ok) throw new Error(`ZenEdu ${res.status} on POST ${path}`);
  return (await res.json()) as T;
}

/** Ітерує всі сторінки; maxPages обмежує тривалість для serverless. */
export async function* zenPages<T>(path: string, perPage = 30, startPage = 1): AsyncGenerator<{ rows: T[]; page: number; lastPage: number }> {
  let page = startPage;
  while (true) {
    const d = await zenGet<Page<T>>(path, { per_page: perPage, page });
    const lastPage = d.meta?.last_page ?? 1;
    yield { rows: d.data ?? [], page, lastPage };
    if (page >= lastPage || !d.data?.length) break;
    page++;
    await sleep(1050);
  }
}

export const zen = {
  bots: () => zenGet<{ data: ZenBot[] }>("/bots").then((r) => r.data),
  offers: (botId: number) => zenGet<Page<ZenOffer>>(`/bot/${botId}/offers`, { per_page: 100 }).then((r) => r.data),
  funnels: (botId: number) => zenGet<Page<ZenFunnel>>(`/bot/${botId}/funnels`, { per_page: 100 }).then((r) => r.data),
  subscribers: (botId: number, startPage = 1) => zenPages<ZenSubscriber>(`/bot/${botId}/subscribers`, 30, startPage),
  orders: (botId: number, startPage = 1) => zenPages<ZenOrder>(`/bot/${botId}/orders`, 30, startPage),
  sendMessage: (botId: number, subscriberId: number, text: string) =>
    zenPost(`/bot/${botId}/subscribers/${subscriberId}/messages`, { text }),
  addTags: (botId: number, subscriberId: number, tags: string[]) =>
    zenPost(`/bot/${botId}/subscribers/${subscriberId}/tags`, Object.fromEntries(tags.map((t, i) => [`tags[${i}]`, t]))),
};

/** Тривалість періоду за назвою оффера (у ZenEdu API немає поля періоду). */
export function periodDaysFromOfferName(name: string, type?: string): number {
  const n = (name || "").toLowerCase();
  if (n.includes("рік") || n.includes("1 рік") || n.includes("year")) return 366;
  if (n.includes("3 місяці") || n.includes("три місяці")) return 92;
  if (n.includes("2 тижні") && type === "subscription_start") return 14;
  return 31;
}
