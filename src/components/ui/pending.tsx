"use client";
import { useEffect, useState } from "react";
import { usePathname, useSearchParams } from "next/navigation";
import { Loader2 } from "lucide-react";

/** Подія, якою дії без звичайного submit (меню ⋮) повідомляють, що робота почалась. */
export const BUSY_EVENT = "hub:busy";
export function markBusy() { if (typeof window !== "undefined") window.dispatchEvent(new Event(BUSY_EVENT)); }

/**
 * Лише візуальний відгук: після надсилання будь-якої форми або дії з меню показує смужку вгорі,
 * плашку «Виконується…» і крутилку на натиснутій кнопці. Знімається, коли сервер повернув оновлену
 * сторінку (новий stamp від Shell), змінилась адреса, або через 12 с. На саму дію не впливає.
 * Перехід за внутрішнім посиланням (меню, списки) показує лише смужку вгорі, щоб було видно, що сторінка вантажиться.
 */
export function PendingIndicator({ stamp }: { stamp: string }) {
  const [busy, setBusy] = useState<false | "action" | "nav">(false);
  const path = usePathname(); const search = useSearchParams()?.toString();

  useEffect(() => {
    const start = () => setBusy("action");
    // клік по внутрішньому посиланню на іншу сторінку: лише смужка завантаження (без нових вкладок, завантажень, Ctrl/Cmd-кліку)
    const onClick = (e: MouseEvent) => {
      if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      const a = (e.target as HTMLElement | null)?.closest?.("a"); if (!a) return;
      if ((a.target && a.target !== "_self") || a.hasAttribute("download")) return;
      const href = a.getAttribute("href") ?? ""; if (!href || href.startsWith("#")) return;
      let url: URL; try { url = new URL(a.href, location.href); } catch { return; }
      if (url.origin !== location.origin || url.pathname.startsWith("/api/")) return;
      if (url.pathname === location.pathname && url.search === location.search) return;
      setBusy((b) => b || "nav");
    };
    const onSubmit = (e: Event) => {
      const form = e.target as HTMLFormElement; const btn = (e as SubmitEvent).submitter as HTMLElement | null;
      if (form.target === "_blank" || form.method?.toLowerCase() === "dialog") return;
      btn?.setAttribute("data-busy", "");
      start();
      // форма з клієнтським обробником (не server action) скасувала надсилання: нічого не чекаємо
      setTimeout(() => { if (e.defaultPrevented && !(form.getAttribute("action") ?? "").startsWith("javascript:")) clear(); }, 0);
    };
    window.addEventListener("submit", onSubmit, true);
    window.addEventListener(BUSY_EVENT, start);
    document.addEventListener("click", onClick, true); // фаза перехоплення: до обробника next/link, який скасовує подію
    return () => { window.removeEventListener("submit", onSubmit, true); window.removeEventListener(BUSY_EVENT, start); document.removeEventListener("click", onClick, true); };
  }, []);

  useEffect(() => { clear(); }, [stamp, path, search]);
  useEffect(() => { if (!busy) return; const t = setTimeout(clear, 12_000); return () => clearTimeout(t); }, [busy]);

  function clear() { setBusy(false); document.querySelectorAll("[data-busy]").forEach((el) => el.removeAttribute("data-busy")); }

  if (!busy) return null;
  return <>
    <div className="busy-bar" aria-hidden />
    {busy === "action" && <div className="busy-toast" role="status" aria-live="polite"><Loader2 size={15} className="spin" /> Виконується…</div>}
  </>;
}
