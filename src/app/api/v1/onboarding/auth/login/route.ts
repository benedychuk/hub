import { json, preflight, notReady } from "../../_lib";
export const dynamic = "force-dynamic";
export const OPTIONS = (req: Request) => preflight(req);
/**
 * Вхід за паролем вимкнено: кабінет відкривається лише через Telegram (кнопка «Увійти через Telegram» з ботом,
 * Mini App, посилання з бота). Стара версія платформи отримує зрозумілу помилку з підказкою.
 */
export async function POST(req: Request) {
  const nr = notReady(req); if (nr) return nr;
  return json(req, { success: false, error: "password_login_disabled", message: "Вхід за паролем більше не потрібен. Увійдіть через Telegram." }, 410);
}
