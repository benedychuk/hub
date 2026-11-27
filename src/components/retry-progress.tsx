"use client";
import { useEffect, useRef } from "react";
import { useRouter } from "next/navigation";

/** Поки на дашборді відкрито фонове списання: кожні ~5 с після попередньої порції просить сервер списати наступну й оновлює сторінку. */
export function RetryProgress({ action }: { action: () => Promise<void> }) {
  const router = useRouter(); const busy = useRef(false);
  useEffect(() => {
    let stop = false;
    const step = async () => {
      if (stop || busy.current) return;
      busy.current = true;
      try { await action(); router.refresh(); } catch { /* наступна спроба через кілька секунд */ }
      busy.current = false;
      if (!stop) timer = setTimeout(step, 5_000);
    };
    let timer = setTimeout(step, 3_000);
    return () => { stop = true; clearTimeout(timer); };
  }, [action, router]);
  return null;
}
