"use client";
import { useState } from "react";
import { Users, SlidersHorizontal, UserCheck } from "lucide-react";
import { RadioCards } from "@/components/ui/controls";

/** Вибір аудиторії: усі / за фільтрами / лише мені. Фільтри показуються лише для другого варіанта. */
export function AudienceMode({ initial, total, filters }: { initial: "all" | "filters" | "me"; total: number; filters: React.ReactNode }) {
  const [mode, setMode] = useState(initial);
  return (
    <>
      <RadioCards name="mode" defaultValue={initial} onChange={(v) => setMode(v as typeof mode)} cols={3} options={[
        { value: "all", label: "Усім підписникам бота", hint: `${total} людей запустили Hub-бот`, icon: <Users size={18} /> },
        { value: "filters", label: "За фільтрами", hint: "підписка, теги, воронки, доступи", icon: <SlidersHorizontal size={18} /> },
        { value: "me", label: "Лише мені", hint: "тест на ваш Telegram", icon: <UserCheck size={18} /> },
      ]} />
      {mode === "filters" && <div style={{ marginTop: 16 }}>{filters}</div>}
    </>
  );
}
