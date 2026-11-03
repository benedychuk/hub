"use client";
import { useEffect, useRef } from "react";
import { useRouter } from "next/navigation";

type Fbq = ((...args: unknown[]) => void) & { callMethod?: (...a: unknown[]) => void; queue: unknown[]; loaded: boolean; version: string; push: unknown };
declare global { interface Window { fbq?: Fbq; _fbq?: Fbq } }

/** Стандартний код Meta Pixel: завантажує fbevents.js один раз і робить init. */
function ensurePixel(id: string) {
  if (window.fbq) return window.fbq;
  const n = function (...args: unknown[]) { if (n.callMethod) n.callMethod(...args); else n.queue.push(args); } as Fbq;
  n.queue = []; n.loaded = true; n.version = "2.0"; n.push = n;
  window.fbq = n; if (!window._fbq) window._fbq = n;
  const t = document.createElement("script"); t.async = true; t.src = "https://connect.facebook.net/en_US/fbevents.js";
  document.head.appendChild(t);
  n("init", id);
  return n;
}

/**
 * Meta Pixel на сторінці результату оплати: PageView завжди, Purchase — лише для підтвердженої оплати.
 * eventID = номер замовлення WayForPay: Meta не задублює подію, якщо сторінку оновлять; додатково пам'ятаємо в браузері.
 */
export function MetaPixel({ pixelId, purchase }: { pixelId: string; purchase?: { value: number; currency: string; orderId: string; contentName: string; contentId: string } }) {
  const viewed = useRef(false);
  const orderId = purchase?.orderId;
  useEffect(() => {
    const fbq = ensurePixel(pixelId);
    if (!viewed.current) { viewed.current = true; fbq("track", "PageView"); } // оновлення сторінки під час очікування не дає повторних PageView
    if (!purchase) return;
    const key = `mp_purchase_${purchase.orderId}`;
    try { if (localStorage.getItem(key)) return; } catch { /* приватний режим */ }
    fbq("track", "Purchase", { value: purchase.value, currency: purchase.currency, content_name: purchase.contentName, content_ids: [purchase.contentId], content_type: "product", num_items: 1 }, { eventID: purchase.orderId });
    try { localStorage.setItem(key, "1"); } catch { /* приватний режим */ }
  }, [pixelId, orderId]); // eslint-disable-line react-hooks/exhaustive-deps
  // eslint-disable-next-line @next/next/no-img-element -- піксель Meta для браузерів без JS, оптимізація зображень не потрібна
  return <noscript><img height="1" width="1" alt="" style={{ display: "none" }} src={`https://www.facebook.com/tr?id=${pixelId}&ev=PageView&noscript=1`} /></noscript>;
}

/** Поки банк підтверджує платіж, сторінка сама оновлюється (до 3 хвилин), щоб показати результат і передати Purchase. */
export function RefreshWhilePending() {
  const router = useRouter();
  useEffect(() => {
    let n = 0;
    const t = setInterval(() => { if (++n > 45) clearInterval(t); else router.refresh(); }, 4000);
    return () => clearInterval(t);
  }, [router]);
  return null;
}
