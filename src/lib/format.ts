export const money = (p: string | number | null | undefined, cur: string | null | undefined) =>
  p == null ? "—" : `${Number(p).toLocaleString("uk-UA")} ${cur === "USD" ? "$" : cur === "EUR" ? "€" : "грн"}`;
export const date = (d: Date | string | null | undefined) => d ? new Date(d).toLocaleDateString("uk-UA") : "—";
export const dateTime = (d: Date | string | null | undefined) => d ? new Date(d).toLocaleString("uk-UA", { timeZone: "Europe/Kyiv", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" }) : "—";
export const fullName = (p: { firstName?: string | null; lastName?: string | null; username?: string | null; telegramUserId?: number }) =>
  [p.firstName, p.lastName].filter(Boolean).join(" ") || (p.username ? "@" + p.username : `tg ${p.telegramUserId}`);
export const STATUS: Record<string, [string, string]> = {
  trialing: ["Trial", "moon"], active: ["Active", "good"], past_due: ["Past due", "warn"], paused: ["Paused", ""], cancelled: ["Cancelled", "mute"], expired: ["Expired", "mute"], none: ["Без підписки", "mute"],
};
export const PERIOD: Record<string, string> = { month: "міс", quarter: "3 міс", year: "рік" };
