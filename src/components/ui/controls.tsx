"use client";
import * as RCheckbox from "@radix-ui/react-checkbox";
import * as RSwitch from "@radix-ui/react-switch";
import * as RRadio from "@radix-ui/react-radio-group";
import * as RMenu from "@radix-ui/react-dropdown-menu";
import * as RTooltip from "@radix-ui/react-tooltip";
import { Check, MoreVertical } from "lucide-react";
import { useState } from "react";

/** Чекбокс, сумісний із формами: у FormData йде name=value, коли увімкнено. */
export function Checkbox({ name, value = "on", defaultChecked, label, hint, disabled }: { name: string; value?: string; defaultChecked?: boolean; label: React.ReactNode; hint?: React.ReactNode; disabled?: boolean }) {
  return (
    <label className={`chk ${disabled ? "dis" : ""}`}>
      <RCheckbox.Root className="chk-box" name={name} value={value} defaultChecked={defaultChecked} disabled={disabled}><RCheckbox.Indicator><Check size={12} strokeWidth={3} /></RCheckbox.Indicator></RCheckbox.Root>
      <span className="chk-t"><span>{label}</span>{hint && <small>{hint}</small>}</span>
    </label>
  );
}
/** Перемикач для налаштувань «увімкнено/вимкнено». */
export function Switch({ name, defaultChecked, label, hint }: { name: string; defaultChecked?: boolean; label: React.ReactNode; hint?: React.ReactNode }) {
  return (
    <label className="sw">
      <span className="chk-t"><span>{label}</span>{hint && <small>{hint}</small>}</span>
      <RSwitch.Root className="sw-root" name={name} value="on" defaultChecked={defaultChecked}><RSwitch.Thumb className="sw-thumb" /></RSwitch.Root>
    </label>
  );
}
/** Сегментований перемикач (2–4 варіанти); значення йде у форму через hidden input. */
export function Segmented({ name, options, defaultValue, onChange }: { name?: string; options: { value: string; label: React.ReactNode; icon?: React.ReactNode }[]; defaultValue: string; onChange?: (v: string) => void }) {
  const [v, setV] = useState(defaultValue);
  return (
    <div className="segc" role="tablist">
      {name && <input type="hidden" name={name} value={v} />}
      {options.map((o) => <button key={o.value} type="button" role="tab" aria-selected={v === o.value} className={v === o.value ? "on" : ""} onClick={() => { setV(o.value); onChange?.(o.value); }}>{o.icon}{o.label}</button>)}
    </div>
  );
}
/** Вибір одного з варіантів великими картками з поясненням. */
export function RadioCards({ name, options, defaultValue, onChange, cols = 3 }: { name: string; options: { value: string; label: string; hint?: string; icon?: React.ReactNode }[]; defaultValue: string; onChange?: (v: string) => void; cols?: 2 | 3 | 4 }) {
  return (
    <RRadio.Root name={name} defaultValue={defaultValue} onValueChange={onChange} className={`rcards c${cols}`}>
      {options.map((o) => <RRadio.Item key={o.value} value={o.value} className="rcard">{o.icon && <span className="rcard-i">{o.icon}</span>}<span className="rcard-t"><b>{o.label}</b>{o.hint && <small>{o.hint}</small>}</span><RRadio.Indicator className="rcard-dot" /></RRadio.Item>)}
    </RRadio.Root>
  );
}

/** Меню ⋮ на Radix: портал, позиціонування, клавіатура. Пункти: MenuLink, MenuAction. */
export function Kebab({ children, label }: { children: React.ReactNode; label?: string }) {
  return (
    <RMenu.Root modal={false}>
      <RMenu.Trigger asChild><button type="button" className={label ? "btn sm" : "kebab"} aria-label={label ?? "Дії"}>{label ?? <MoreVertical size={16} />}</button></RMenu.Trigger>
      <RMenu.Portal><RMenu.Content className="dd rx" align="end" sideOffset={6} collisionPadding={8}>{children}</RMenu.Content></RMenu.Portal>
    </RMenu.Root>
  );
}
export function MenuLink({ href, icon, children, external }: { href: string; icon?: React.ReactNode; children: React.ReactNode; external?: boolean }) {
  return <RMenu.Item asChild><a href={href} target={external ? "_blank" : undefined} rel={external ? "noreferrer" : undefined}>{icon}{children}</a></RMenu.Item>;
}
/** Пункт меню, що виконує server action; confirm — текст підтвердження для небезпечних дій. */
export function MenuAction({ action, fields = {}, icon, children, confirm, danger, disabled }: { action: (fd: FormData) => void | Promise<void>; fields?: Record<string, string | number>; icon?: React.ReactNode; children: React.ReactNode; confirm?: string; danger?: boolean; disabled?: boolean }) {
  return (
    <form action={action}>
      {Object.entries(fields).map(([k, v]) => <input key={k} type="hidden" name={k} value={v} />)}
      <RMenu.Item asChild disabled={disabled}><button type="submit" className={danger ? "danger" : ""} onClick={(e) => { if (confirm && !window.confirm(confirm)) e.preventDefault(); }}>{icon}{children}</button></RMenu.Item>
    </form>
  );
}
export function MenuSep() { return <RMenu.Separator className="sep" />; }

export function Tip({ text, children }: { text: string; children: React.ReactNode }) {
  return <RTooltip.Provider delayDuration={200}><RTooltip.Root><RTooltip.Trigger asChild>{children}</RTooltip.Trigger><RTooltip.Portal><RTooltip.Content className="tip" sideOffset={6}>{text}<RTooltip.Arrow className="tip-a" /></RTooltip.Content></RTooltip.Portal></RTooltip.Root></RTooltip.Provider>;
}

/** Перемикач у таблиці, що одразу сабмітить форму. */
export function AutoSubmitToggleClient({ checked, label }: { checked: boolean; label?: string }) {
  return <RSwitch.Root className="sw-root" defaultChecked={checked} aria-label={label} onClick={(e) => { const f = (e.currentTarget as HTMLElement).closest("form"); setTimeout(() => f?.requestSubmit(), 0); }}><RSwitch.Thumb className="sw-thumb" /></RSwitch.Root>;
}
