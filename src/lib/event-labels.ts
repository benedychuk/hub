/** Людські підписи подій для історії в картці людини: назва, деталі, посилання на обʼєкт. */
export type EventRow = { id: number; type: string; source: string; createdAt: Date; payload: Record<string, unknown> | null };
export type Names = { funnels: Record<number, { name: string; kind: string }>; plans: Record<number, string>; broadcasts: Record<number, string>; steps: Record<number, string> };
export type Described = { title: string; detail?: string; href?: string; tone?: "good" | "warn" | "crit" | "moon" | "mute" | "acc"; group: "bot" | "funnel" | "payment" | "access" | "tag" | "admin" | "other" };

const money = (a: unknown, c: unknown) => a == null ? "" : `${Number(a).toLocaleString("uk-UA")} ${c === "USD" ? "$" : c === "EUR" ? "€" : "грн"}`;
const dt = (v: unknown) => v ? new Date(String(v)).toLocaleDateString("uk-UA") : "";

export function describeEvent(e: EventRow, n: Names): Described {
  const p = (e.payload ?? {}) as Record<string, unknown>;
  const fid = Number(p.funnelId ?? 0); const f = fid ? n.funnels[fid] : undefined;
  const fHref = f ? `${f.kind === "product" ? "/products" : "/funnels"}/${fid}` : undefined;
  const fName = f?.name ?? (p.name ? String(p.name) : fid ? `#${fid}` : "");
  const planId = Number(p.planId ?? 0); const planName = planId ? n.plans[planId] : (p.name ? String(p.name) : "");
  if (e.type.startsWith("onboarding.video_lesson_")) return { title: `Відкрила відеоурок ${e.type.match(/_(\d+)_/)?.[1] ?? ""} у кабінеті`, detail: p.title ? String(p.title) : p.url ? String(p.url) : undefined, group: "funnel" };
  switch (e.type) {
    case "bot.start": return { title: "Запустила Hub-бот", detail: p.payload ? `посилання ?start=${String(p.payload)}` : undefined, group: "bot", tone: "moon" };
    case "bot.message": return { title: p.media ? `Надіслала в бот ${labelMedia((p.media as { kind?: string })?.kind)}` : "Написала в бот", detail: p.text ? String(p.text).slice(0, 160) : undefined, group: "bot" };
    case "bot.blocked": return { title: "Заблокувала Hub-бот", group: "bot", tone: "crit" };
    case "bot.unblocked": return { title: "Розблокувала Hub-бот", group: "bot", tone: "good" };
    case "funnel.enrolled": return { title: `${p.resumed ? "Повернулась у" : "Додано до"} ${f?.kind === "product" ? "продукту" : "воронки"} «${fName}»`, detail: reasonLabel(String(p.reason ?? "")), href: fHref, group: "funnel", tone: "moon" };
    case "funnel.intro": return { title: `Побачила вступ воронки «${fName}»`, href: fHref, group: "funnel" };
    case "funnel.answer": return { title: `Відповіла на крок${n.steps[Number(p.stepId)] ? ` «${n.steps[Number(p.stepId)]}»` : ""}`, detail: `${String(p.answer ?? "").slice(0, 160)}${p.correct === true ? " · правильно" : p.correct === false ? " · неправильно" : ""}`, group: "funnel" };
    case "funnel.assignment": return { title: `Надіслала завдання${n.steps[Number(p.stepId)] ? ` до кроку «${n.steps[Number(p.stepId)]}»` : ""}`, detail: String(p.answer ?? "").slice(0, 160), group: "funnel", tone: "good" };
    case "tag.added": return { title: `Додано тег «${String(p.tag ?? "")}»`, detail: p.button ? `кнопка «${String(p.button)}»` : p.source ? String(p.source) : undefined, group: "tag" };
    case "tag.removed": return { title: `Прибрано тег «${String(p.tag ?? "")}»`, group: "tag", tone: "mute" };
    case "payment.started": return { title: `Відкрила оплату${planName ? ` «${planName}»` : ""}`, detail: `${money(p.amount, p.currency)}${p.mode === "test" ? " · тест" : ""}`, href: planId ? `/offers/${planId}` : undefined, group: "payment" };
    case "payment.approved": return { title: p.kind === "renewal" ? "Автосписання пройшло" : `Оплата пройшла${planName ? `: «${planName}»` : ""}`, detail: `${money(p.amount, p.currency)}${p.until ? ` · доступ до ${dt(p.until)}` : ""}`, href: planId ? `/offers/${planId}` : undefined, group: "payment", tone: "good" };
    case "payment.declined": return { title: "Оплата не пройшла", detail: `${String(p.reason ?? "")} ${p.code ? `(${String(p.code)})` : ""}`.trim(), group: "payment", tone: "crit" };
    case "payment.refunded": return { title: "Повернення коштів", detail: money(p.amount, "UAH"), group: "payment", tone: "warn" };
    case "payment.card_linked": return { title: p.migrate ? "Привʼязала картку для переїзду в Hub" : "Оновила картку", detail: p.nextChargeAt ? `наступне списання ${dt(p.nextChargeAt)}` : undefined, group: "payment", tone: "good" };
    case "payment.retry_scheduled": return { title: `Списання не пройшло, спроба ${String(p.retry ?? "")}`, detail: `наступна ${dt(p.next)} · ${String(p.reason ?? "")}`, group: "payment", tone: "warn" };
    case "payment.migrate_invite": return { title: "Надіслано запрошення на переїзд у Hub", detail: p.periodEnd ? `списання в ZenEdu ${dt(p.periodEnd)}` : undefined, group: "payment" };
    case "payment.bad_signature": return { title: "Відхилено зворотний виклик WayForPay (підпис)", group: "payment", tone: "crit" };
    case "subscription.cancel_scheduled": return { title: "Вимкнула продовження підписки", detail: p.until ? `доступ до ${dt(p.until)}` : undefined, group: "payment", tone: "warn" };
    case "subscription.resumed": return { title: "Відновила підписку", group: "payment", tone: "good" };
    case "subscription.paused": return { title: "Підписку поставлено на паузу", group: "payment", tone: "warn" };
    case "subscription.expired": return { title: "Підписка завершилась", detail: String(p.reason ?? ""), group: "payment", tone: "mute" };
    case "access.granted": return { title: `Відкрито доступ за оффером «${planName || String(p.plan ?? "")}»`, detail: `${p.until ? `до ${dt(p.until)}` : "безстроково"}${e.source === "access_link" ? " · за посиланням доступу" : e.source === "admin" ? " · вручну" : ""}`, href: planId ? `/offers/${planId}` : undefined, group: "access", tone: "good" };
    case "entitlement.granted": return { title: `Видано право на ${resourceLabel(String(p.key ?? ""), n)}`, detail: p.days ? `на ${String(p.days)} дн` : undefined, group: "access", tone: "good" };
    case "entitlement.revoked": return { title: `Забрано право на ${resourceLabel(String(p.key ?? ""), n)}`, group: "access", tone: "warn" };
    case "channel.invited": return { title: "Надіслано посилання в канал", detail: String(p.resource ?? ""), group: "access", tone: "good" };
    case "channel.invite_undelivered": return { title: "Посилання в канал не доставлено: бот не запущено", detail: String(p.resource ?? ""), group: "access", tone: "warn" };
    case "channel.kicked": return { title: "Виключено з каналу", detail: String(p.resourceKey ?? p.key ?? ""), group: "access", tone: "warn" };
    case "channel.kick_failed": return { title: "Не вдалося виключити з каналу", detail: String(p.error ?? ""), group: "access", tone: "crit" };
    case "channel.joined_without_access": return { title: "Зайшла в канал без права", detail: String(p.resourceKey ?? ""), group: "access", tone: "warn" };
    case "channel.invite_failed": return { title: "Не вдалося надіслати посилання в канал", detail: String(p.error ?? ""), group: "access", tone: "crit" };
    case "shchyro.granted": return { title: "Відкрито доступ до бота «Щиро»", detail: `${p.source === "manual" ? "ручне право" : p.source === "zenedu" ? "підписка ZenEdu" : `тариф ${String(p.plan ?? "")}`}${p.until ? ` · до ${dt(p.until)}` : ""}`, group: "access", tone: "good" };
    case "shchyro.revoked": return { title: "Закрито доступ до бота «Щиро»", detail: "право закінчилось або підписку завершено", group: "access", tone: "warn" };
    case "shchyro.error": return { title: `Не вдалося ${p.op === "revoke" ? "закрити" : "відкрити"} доступ у «Щиро»`, detail: String(p.error ?? ""), group: "access", tone: "crit" };
    case "shchyro.sync": return { title: "Звірка зі «Щиро»", detail: `${p.mode === "preview" ? "перевірка" : "застосовано"}: +${String(p.activated ?? 0)} / −${String(p.deactivated ?? 0)}, захищених ${String(p.protected_untouched ?? 0)}`, group: "access", tone: "moon" };
    case "shchyro.sync_blocked": return { title: "Звірку зі «Щиро» зупинено", detail: `вимкнулось би ${String(p.deactivated ?? 0)} при ліміті ${String(p.limit ?? "")}`, group: "access", tone: "warn" };
    case "shchyro.notified": return { title: "Надіслано повідомлення через бота «Щиро»", detail: p.text ? String(p.text).slice(0, 160) : undefined, group: "bot", tone: "moon" };
    case "shchyro.notify_failed": return { title: "Повідомлення через «Щиро» не доставлено", detail: String(p.error ?? ""), group: "bot", tone: "warn" };
    case "shchyro.import": return { title: "Імпорт доступів зі «Щиро»", detail: `видано перехідних прав ${String(p.granted ?? 0)}, уже мали ${String(p.already ?? 0)}`, group: "access", tone: "moon" };
    case "onboarding.onboarding_registered": return { title: "Зареєструвалась у кабінеті онбордингу", detail: p.via === "bot" || p.via === "magic" ? "через Telegram" : p.contact ? `контакт ${String(p.contact)}` : undefined, group: "funnel", tone: "moon" };
    case "onboarding.telegram_confirmed": return { title: "Підтвердила кабінет через Telegram", group: "funnel", tone: "good" };
    case "onboarding.cabinet_link_sent": return { title: "Отримала посилання в кабінет", detail: p.via === "admin" ? "з картки людини" : "у боті", group: "funnel" };
    case "onboarding.magic_used": return { title: "Увійшла в кабінет за посиланням з бота", group: "funnel" };
    case "onboarding.quiz_started": return { title: "Почала базовий квіз", group: "funnel" };
    case "onboarding.quiz_completed": return { title: `Пройшла квіз: ${String(p.scenario_name ?? p.tag ?? "")}`.replace(/<[^>]+>/g, ""), detail: p.quiz_result_id ? `сценарій ${String(p.quiz_result_id)}` : undefined, group: "funnel", tone: "good" };
    case "onboarding.deep_quiz_test_completed": return { title: "Пройшла додатковий тест діагностики", detail: p.test1 ? "психоемоційний ресурс" : p.test2 ? "кордони та безпека" : undefined, group: "funnel" };
    case "onboarding.deep_quiz_completed": return { title: "Пройшла глибинне тестування", group: "funnel", tone: "good" };
    case "onboarding.diagnostic_completed": return { title: "Завершила всі 3 тести діагностики", group: "funnel", tone: "good" };
    case "onboarding.feedback_completed": return { title: "Заповнила анкету зворотного зв'язку", detail: p.extended ? "бонус +7 днів" : undefined, group: "funnel", tone: "good" };
    case "onboarding.trial_extended_7_days": return { title: "Тріал продовжено на 7 днів", detail: p.until ? `до ${dt(p.until)}` : undefined, group: "funnel", tone: "good" };
    case "onboarding.trial_expiring_soon": return { title: "Тріал кабінету закінчується за 3 дні", group: "funnel", tone: "warn" };
    case "onboarding.trial_14_expired": return { title: "14 днів тріалу минули", detail: "пропонується анкета за +7 днів", group: "funnel", tone: "warn" };
    case "onboarding.trial_fully_expired": return { title: "Доступ до кабінету завершено", group: "funnel", tone: "mute" };
    case "onboarding.cta_club_clicked": return { title: "Натиснула «Вступити в клуб» у кабінеті", group: "payment", tone: "acc" };
    case "onboarding.cta_schyro_clicked": return { title: "Відкрила «Щиро» з кабінету", group: "bot", tone: "acc" };
    case "onboarding.shchyro_synced": return { title: "Результат квізу передано в пам'ять «Щиро»", detail: String(p.scenario ?? ""), group: "access", tone: "good" };
    case "onboarding.shchyro_sync_failed": return { title: "Не вдалося передати квіз у «Щиро»", detail: String(p.error ?? ""), group: "access", tone: "crit" };
    case "offer.shown": return { title: `Відкрила оффер у боті${planName ? `: «${planName}»` : ""}`, href: planId ? `/offers/${planId}` : undefined, group: "payment" };
    case "broadcast.click": { const bid = Number(p.broadcastId ?? 0); return { title: `Натиснула кнопку «${String(p.button ?? "")}» у розсилці${bid && n.broadcasts[bid] ? ` «${n.broadcasts[bid]}»` : ""}`, href: bid ? `/broadcasts/${bid}` : undefined, group: "bot", tone: "moon" }; }
    case "broadcast.action_error": return { title: "Помилка дії кнопки розсилки", detail: String(p.error ?? ""), group: "bot", tone: "crit" };
    case "admin.note": return { title: "Нотатку оновлено", group: "admin", tone: "mute" };
    default:
      if (e.source === "zenedu") return { title: zenLabel(e.type), detail: p.offer_name ? String(p.offer_name) : undefined, group: "other", tone: "mute" };
      return { title: e.type, group: "other", tone: "mute" };
  }
}
function reasonLabel(r: string) {
  if (!r) return undefined;
  if (r.startsWith("start:")) return `за посиланням ?start=${r.slice(6)}`;
  return ({ manual: "додано вручну", test: "тест", intro: "натиснула «Отримати доступ»", keyword: "за ключовим словом", direct: "після запуску бота", broadcast: "з розсилки", offer: "за оффером", button: "з кнопки кроку" } as Record<string, string>)[r] ?? r;
}
function labelMedia(k?: string) { return ({ video_note: "кружечок", photo: "фото", video: "відео", animation: "GIF", voice: "голосове", audio: "аудіо", document: "файл", sticker: "стікер" } as Record<string, string>)[k ?? ""] ?? "медіа"; }
function resourceLabel(key: string, n: Names) { const m = key.match(/^product:(\d+)$/); if (m) return `продукт «${n.funnels[Number(m[1])]?.name ?? key}»`; return `«${key}»`; }
function zenLabel(t: string) { return ({ subscription_start: "Підписка оформлена (ZenEdu)", subscription_renew: "Підписку продовжено (ZenEdu)", one_time: "Разова оплата (ZenEdu)", subscription_cancel: "Підписку скасовано (ZenEdu)" } as Record<string, string>)[t] ?? `ZenEdu: ${t}`; }
