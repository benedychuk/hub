"use client";
/** Чекбокс «обрати всіх на сторінці» для масових дій: перемикає всі чекбокси з name="ids" у формі bulk. */
export function SelectAll() {
  return <input type="checkbox" aria-label="Обрати всіх на сторінці" onChange={(e) => { document.querySelectorAll<HTMLInputElement>('input[name="ids"]').forEach((b) => { b.checked = e.target.checked; }); }} />;
}
