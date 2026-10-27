"use client";
import { CopyField } from "@/components/ui/copy-field";
/** Сумісна обгортка: усі місця з CopyBox тепер показують поле з копіюванням із UI-кіту. */
export function CopyBox({ text }: { text: string }) {
  return <CopyField value={text} open={/^https?:\/\//.test(text)} />;
}
