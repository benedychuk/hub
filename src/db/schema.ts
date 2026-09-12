import {
  pgTable, serial, text, integer, bigint, boolean, timestamp, jsonb, numeric, index, uniqueIndex,
} from "drizzle-orm/pg-core";

// Людина. Ключ — telegram user id, один на всі боти.
export const persons = pgTable("persons", {
  id: serial("id").primaryKey(),
  telegramUserId: bigint("telegram_user_id", { mode: "number" }).notNull(),
  firstName: text("first_name"),
  lastName: text("last_name"),
  username: text("username"),
  phone: text("phone"),
  email: text("email"),
  tags: jsonb("tags").$type<string[]>().notNull().default([]),
  notes: text("notes"),
  zenSubscriberId: integer("zen_subscriber_id"),
  zenIsActive: boolean("zen_is_active"),
  zenIsBlocked: boolean("zen_is_blocked"),
  utm: jsonb("utm").$type<Record<string, string>[]>().default([]),
  customFields: jsonb("custom_fields").$type<Record<string, unknown>>().default({}),
  lastActiveAt: timestamp("last_active_at", { withTimezone: true }),
  zenCreatedAt: timestamp("zen_created_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  uniqueIndex("persons_tg_uidx").on(t.telegramUserId),
  index("persons_username_idx").on(t.username),
  index("persons_zen_idx").on(t.zenSubscriberId),
]);

// Наші боти (клубний Hub-бот, «Щиро», інші).
export const bots = pgTable("bots", {
  id: serial("id").primaryKey(),
  key: text("key").notNull().unique(), // "hub" | "shchyro" | ...
  name: text("name").notNull(),
  username: text("username"),
  role: text("role").notNull().default("club"),
  mode: text("mode").notNull().default("managed"), // managed (токен у Hub) | external (свій сервер, API-ключ) | zenedu
  resourceKey: text("resource_key"), // яке право перевіряє зовнішній бот
  apiKeyHash: text("api_key_hash"),
  apiKeyPrefix: text("api_key_prefix"),
  lastSeenAt: timestamp("last_seen_at", { withTimezone: true }),
  requestsToday: integer("requests_today").notNull().default(0),
  requestsDay: text("requests_day"),
  webhookSetAt: timestamp("webhook_set_at", { withTimezone: true }),
  isActive: boolean("is_active").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

// Факт, що людина натиснула /start у конкретному боті.
export const identities = pgTable("identities", {
  id: serial("id").primaryKey(),
  personId: integer("person_id").notNull().references(() => persons.id, { onDelete: "cascade" }),
  botKey: text("bot_key").notNull(),
  chatId: bigint("chat_id", { mode: "number" }),
  startedAt: timestamp("started_at", { withTimezone: true }).notNull().defaultNow(),
  blockedAt: timestamp("blocked_at", { withTimezone: true }),
  lastMessageAt: timestamp("last_message_at", { withTimezone: true }),
}, (t) => [uniqueIndex("identities_person_bot_uidx").on(t.personId, t.botKey)]);

// Ресурс — те, до чого дається право.
export const resources = pgTable("resources", {
  id: serial("id").primaryKey(),
  key: text("key").notNull().unique(), // club.channel, club.chat, shchyro.access, archive.access
  name: text("name").notNull(),
  kind: text("kind").notNull(), // telegram_channel | telegram_group | bot_feature | external_url | course
  config: jsonb("config").$type<Record<string, unknown>>().notNull().default({}),
  isActive: boolean("is_active").notNull().default(true),
});

export type OfferDesign = {
  titleMode?: "offer" | "custom"; title?: string;
  description?: string;   // Telegram HTML, показується на сторінці оплати й у повідомленні бота
  buttonText?: string;
  image?: string;         // data URL
};
export type OfferSettings = {
  removeContentOnEnd?: boolean;   // після закінчення доступу видалити надіслані кроки продуктів із бота
  postPurchaseText?: string;      // повідомлення в боті після оплати (Telegram HTML)
  retries?: boolean;              // повторні списання 1/3/5 днів (підписка)
  reminder?: boolean;             // нагадування про майбутнє списання
  expiryReminder?: boolean;       // нагадування про закінчення доступу (разова оплата з обмеженим доступом)
  expiryDays?: number; expiryText?: string; renewalOfferId?: number;
  collectEmail?: boolean;         // просити email на сторінці оплати
};
// Оффер Hub (ZenEdu Offer): те, що продається — набір продуктів і каналів, тип оплати, ціна, інтервал, тривалість доступу.
export const plans = pgTable("plans", {
  id: serial("id").primaryKey(),
  key: text("key").notNull().unique(),
  name: text("name").notNull(),
  price: numeric("price", { precision: 12, scale: 2 }).notNull(),
  currency: text("currency").notNull().default("UAH"),
  paymentType: text("payment_type").notNull().default("subscription"), // subscription | one_time
  period: text("period").notNull().default("month"), // day | week | month | quarter | year — одиниця інтервалу підписки
  intervalCount: integer("interval_count").notNull().default(1),   // N одиниць в інтервалі
  trialDays: integer("trial_days").notNull().default(0),
  trialPrice: numeric("trial_price", { precision: 12, scale: 2 }),
  entitlements: jsonb("entitlements").$type<Record<string, string>>().notNull().default({}), // resourceKey -> quota/label (канали, групи, функції бота)
  products: jsonb("products").$type<number[]>().notNull().default([]), // id цифрових продуктів (funnels.kind = product)
  accessMode: text("access_mode").notNull().default("forever"), // разова оплата: forever | days | until | none
  accessDays: integer("access_days"),
  accessUntil: timestamp("access_until", { withTimezone: true }),
  salesEndAt: timestamp("sales_end_at", { withTimezone: true }),
  spotsLimit: integer("spots_limit"),
  showInBot: boolean("show_in_bot").notNull().default(true),
  design: jsonb("design").$type<OfferDesign>().notNull().default({}),
  settings: jsonb("settings").$type<OfferSettings>().notNull().default({}),
  isActive: boolean("is_active").notNull().default(true),
  isFeatured: boolean("is_featured").notNull().default(false),
  sortOrder: integer("sort_order").notNull().default(0),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

// Оффери (поки що імпорт із ZenEdu; власні — пізніше).
export const offers = pgTable("offers", {
  id: serial("id").primaryKey(),
  source: text("source").notNull().default("zenedu"),
  zenOfferId: integer("zen_offer_id"),
  planId: integer("plan_id").references(() => plans.id),
  name: text("name").notNull(),
  price: numeric("price", { precision: 12, scale: 2 }),
  currency: text("currency"),
  isSubscription: boolean("is_subscription").notNull().default(true),
  isActive: boolean("is_active").notNull().default(true),
  link: text("link"),
  landingLink: text("landing_link"),
  raw: jsonb("raw"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [uniqueIndex("offers_zen_uidx").on(t.zenOfferId)]);

// Замовлення / платежі.
export const orders = pgTable("orders", {
  id: serial("id").primaryKey(),
  source: text("source").notNull().default("zenedu"),
  zenOrderId: integer("zen_order_id"),
  personId: integer("person_id").references(() => persons.id),
  offerId: integer("offer_id").references(() => offers.id),
  offerName: text("offer_name"),
  type: text("type"), // subscription_start | subscription_renew | one_time
  price: numeric("price", { precision: 12, scale: 2 }).notNull().default("0"),
  currency: text("currency").notNull().default("UAH"),
  status: text("status").notNull().default("paid"),
  paymentSystem: text("payment_system"),
  paidAt: timestamp("paid_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [uniqueIndex("orders_zen_uidx").on(t.zenOrderId), index("orders_person_idx").on(t.personId)]);

// Підписка.
export const subscriptions = pgTable("subscriptions", {
  id: serial("id").primaryKey(),
  personId: integer("person_id").notNull().references(() => persons.id, { onDelete: "cascade" }),
  planId: integer("plan_id").references(() => plans.id),
  offerId: integer("offer_id").references(() => offers.id),
  source: text("source").notNull().default("zenedu"), // zenedu | hub
  kind: text("kind").notNull().default("subscription"), // subscription | one_time | grant
  accessLinkId: integer("access_link_id"),
  status: text("status").notNull().default("active"), // trialing | active | past_due | paused | cancelled | expired
  price: numeric("price", { precision: 12, scale: 2 }).notNull().default("0"),
  currency: text("currency").notNull().default("UAH"),
  periodDays: integer("period_days").notNull().default(31),
  currentPeriodEnd: timestamp("current_period_end", { withTimezone: true }),
  cancelAtPeriodEnd: boolean("cancel_at_period_end").notNull().default(false),
  paymentMethodId: integer("payment_method_id"),
  nextChargeAt: timestamp("next_charge_at", { withTimezone: true }),
  nextRetryAt: timestamp("next_retry_at", { withTimezone: true }),
  retryCount: integer("retry_count").notNull().default(0),
  pausedAt: timestamp("paused_at", { withTimezone: true }),
  cancelledAt: timestamp("cancelled_at", { withTimezone: true }),
  remindedFor: timestamp("reminded_for", { withTimezone: true }),
  migratedFromZen: integer("migrated_from_zen"),
  zenCancelledAt: timestamp("zen_cancelled_at", { withTimezone: true }),
  startedAt: timestamp("started_at", { withTimezone: true }),
  lastPaymentAt: timestamp("last_payment_at", { withTimezone: true }),
  paymentsCount: integer("payments_count").notNull().default(0),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [index("subs_person_source_idx").on(t.personId, t.source), index("subs_status_idx").on(t.status)]);

// Право людини на ресурс.
export const entitlements = pgTable("entitlements", {
  id: serial("id").primaryKey(),
  personId: integer("person_id").notNull().references(() => persons.id, { onDelete: "cascade" }),
  resourceKey: text("resource_key").notNull(),
  subscriptionId: integer("subscription_id").references(() => subscriptions.id, { onDelete: "set null" }),
  grantedBy: text("granted_by").notNull().default("subscription"), // subscription | manual | zenedu
  quota: text("quota"),
  validUntil: timestamp("valid_until", { withTimezone: true }),
  revokedAt: timestamp("revoked_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [index("ent_person_idx").on(t.personId), index("ent_res_idx").on(t.resourceKey)]);

// Події (оплата, повідомлення, вебхуки, дії адміна).
export const memberships = pgTable("memberships", {
  id: serial("id").primaryKey(),
  personId: integer("person_id").notNull().references(() => persons.id, { onDelete: "cascade" }),
  resourceKey: text("resource_key").notNull(),
  status: text("status").notNull().default("none"),
  inviteLink: text("invite_link"),
  inviteExpiresAt: timestamp("invite_expires_at", { withTimezone: true }),
  invitedAt: timestamp("invited_at", { withTimezone: true }),
  joinedAt: timestamp("joined_at", { withTimezone: true }),
  leftAt: timestamp("left_at", { withTimezone: true }),
  kickedAt: timestamp("kicked_at", { withTimezone: true }),
  lastCheckedAt: timestamp("last_checked_at", { withTimezone: true }),
  note: text("note"),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [uniqueIndex("memberships_person_res_uidx").on(t.personId, t.resourceKey), index("memberships_status_idx").on(t.status)]);

export const events = pgTable("events", {
  id: serial("id").primaryKey(),
  personId: integer("person_id").references(() => persons.id, { onDelete: "set null" }),
  type: text("type").notNull(),
  source: text("source").notNull().default("hub"),
  payload: jsonb("payload").$type<Record<string, unknown>>().default({}),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [index("events_person_idx").on(t.personId), index("events_type_idx").on(t.type), index("events_created_idx").on(t.createdAt)]);

// Папки воронок.
export const funnelFolders = pgTable("funnel_folders", {
  id: serial("id").primaryKey(),
  kind: text("kind").notNull().default("funnel"), // funnel | product
  name: text("name").notNull(),
  sortOrder: integer("sort_order").notNull().default(0),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

// Воронки (структура як у ZenEdu; імпорт із ZenEdu + власні).
// kind = product: цифровий продукт (ZenEdu Digital product) — той самий редактор кроків, але доступ дається офферами й посиланнями доступу, а не /start.
export const funnels = pgTable("funnels", {
  id: serial("id").primaryKey(),
  source: text("source").notNull().default("hub"),
  kind: text("kind").notNull().default("funnel"), // funnel | product
  zenFunnelId: integer("zen_funnel_id"),
  folderId: integer("folder_id").references(() => funnelFolders.id, { onDelete: "set null" }),
  name: text("name").notNull(),
  description: text("description"),
  buttonText: text("button_text"),
  cover: text("cover"), // data URL зображення обкладинки
  entry: text("entry"),
  status: text("status").notNull().default("draft"), // draft | active | stopped
  isActive: boolean("is_active").notNull().default(false),
  subscribersCount: integer("subscribers_count").notNull().default(0),
  stepsCount: integer("steps_count").notNull().default(0),
  settings: jsonb("settings").$type<Record<string, unknown>>().notNull().default({}),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [uniqueIndex("funnels_zen_uidx").on(t.zenFunnelId), index("funnels_folder_idx").on(t.folderId)]);

// Модулі (секції) всередині воронки.
export const funnelModules = pgTable("funnel_modules", {
  id: serial("id").primaryKey(),
  funnelId: integer("funnel_id").notNull().references(() => funnels.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  position: integer("position").notNull().default(0),
});

export const funnelSteps = pgTable("funnel_steps", {
  id: serial("id").primaryKey(),
  funnelId: integer("funnel_id").notNull().references(() => funnels.id, { onDelete: "cascade" }),
  moduleId: integer("module_id").references(() => funnelModules.id, { onDelete: "set null" }),
  position: integer("position").notNull().default(0),
  type: text("type").notNull().default("message"), // message | lesson | assignment | survey | quiz | question
  title: text("title"),
  body: text("body"),
  isActive: boolean("is_active").notNull().default(true),
  config: jsonb("config").$type<Record<string, unknown>>().notNull().default({}),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

// Команди меню, прив'язані до воронки.
export const funnelCommands = pgTable("funnel_commands", {
  id: serial("id").primaryKey(),
  funnelId: integer("funnel_id").notNull().references(() => funnels.id, { onDelete: "cascade" }),
  command: text("command").notNull(), // без слеша
  description: text("description"),
  action: jsonb("action").$type<{ type: "step" | "text"; stepId?: number; text?: string }>().notNull().default({ type: "text", text: "" }),
  position: integer("position").notNull().default(0),
});

// Проходження воронки конкретною людиною.
export const funnelEnrollments = pgTable("funnel_enrollments", {
  id: serial("id").primaryKey(),
  funnelId: integer("funnel_id").notNull().references(() => funnels.id, { onDelete: "cascade" }),
  personId: integer("person_id").notNull().references(() => persons.id, { onDelete: "cascade" }),
  status: text("status").notNull().default("active"), // active | done | stopped
  nextPosition: integer("next_position").notNull().default(0),
  nextAt: timestamp("next_at", { withTimezone: true }),
  awaitingStepId: integer("awaiting_step_id"), // крок, що чекає відповіді (завдання, запитання)
  lastStepAt: timestamp("last_step_at", { withTimezone: true }),
  stopReason: text("stop_reason"),
  startedAt: timestamp("started_at", { withTimezone: true }).notNull().defaultNow(),
  finishedAt: timestamp("finished_at", { withTimezone: true }),
}, (t) => [index("fe_due_idx").on(t.status, t.nextAt), index("fe_person_idx").on(t.personId)]);

// Факт відправлення кроку людині (для статистики).
export const funnelDeliveries = pgTable("funnel_deliveries", {
  id: serial("id").primaryKey(),
  enrollmentId: integer("enrollment_id").notNull().references(() => funnelEnrollments.id, { onDelete: "cascade" }),
  stepId: integer("step_id").notNull().references(() => funnelSteps.id, { onDelete: "cascade" }),
  personId: integer("person_id").notNull(),
  telegramMessageId: integer("telegram_message_id"),
  extraMessageIds: jsonb("extra_message_ids").$type<number[]>().notNull().default([]),
  clicked: boolean("clicked").notNull().default(false),
  answer: text("answer"),
  answeredAt: timestamp("answered_at", { withTimezone: true }),
  deleteAt: timestamp("delete_at", { withTimezone: true }),
  deletedAt: timestamp("deleted_at", { withTimezone: true }),
  sentAt: timestamp("sent_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [index("fd_step_idx").on(t.stepId), index("fd_delete_idx").on(t.deleteAt)]);

// Бібліотека медіа: файли, надіслані в Hub-бот (file_id придатний для повторного надсилання цим ботом).
export const media = pgTable("media", {
  id: serial("id").primaryKey(),
  kind: text("kind").notNull(), // photo | video | video_note | audio | voice | document | animation | sticker
  fileId: text("file_id").notNull(),
  fileUniqueId: text("file_unique_id").notNull(),
  title: text("title"),
  caption: text("caption"),
  width: integer("width"), height: integer("height"), duration: integer("duration"), fileSize: integer("file_size"),
  mimeType: text("mime_type"),
  fromPersonId: integer("from_person_id").references(() => persons.id, { onDelete: "set null" }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [uniqueIndex("media_unique_uidx").on(t.fileUniqueId)]);

export type BroadcastButton = {
  text: string;
  color?: "default" | "primary" | "success" | "danger";
  type: "link" | "action" | "payment" | "miniapp";
  url?: string;            // link / miniapp / payment (посилання на оплату оффера)
  directLink?: boolean;    // link: без редиректу й трекінгу кліків
  tags?: string[];         // теги за клік
  actions?: { type: "send_text" | "call_command" | "add_offer" | "add_funnel" | "remove_funnel" | "add_tags" | "remove_tags" | "delete_message"; text?: string; command?: string; offerId?: number; funnelId?: number; tags?: string[] }[];
};
export type BroadcastAudience = {
  customer?: "any" | "customer" | "not";
  subStatus?: string[];      // active | trialing | past_due | cancelled | expired | none
  tagsAny?: string[]; tagsAll?: string[]; tagsNone?: string[];
  funnelIn?: number[]; funnelNotIn?: number[];
  planIds?: number[]; offerIds?: number[];
  entitlements?: string[];   // ключі ресурсів з активним доступом
  activeDays?: number;       // активність у боті за останні N днів
  startedAfter?: string; startedBefore?: string; // дата запуску Hub-бота
  includeIds?: number[]; excludeIds?: number[];
  onlyAdmin?: boolean;       // тест: лише адміністратор
};

// Розсилки (структура як у ZenEdu: Зміст → Отримувачі → Надсилання).
export const broadcasts = pgTable("broadcasts", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  botKey: text("bot_key").notNull().default("hub"),
  audience: jsonb("audience").$type<BroadcastAudience>().notNull().default({}),
  text: text("text").notNull().default(""),
  attachments: jsonb("attachments").$type<number[]>().notNull().default([]),
  attachedToText: boolean("attached_to_text").notNull().default(true), // медіа з підписом (текст ≤ 1024)
  spoiler: boolean("spoiler").notNull().default(false),               // приховати медіа спойлером
  buttons: jsonb("buttons").$type<BroadcastButton[]>().notNull().default([]),
  protectContent: boolean("protect_content").notNull().default(false),
  disablePreview: boolean("disable_preview").notNull().default(false),
  scheduledAt: timestamp("scheduled_at", { withTimezone: true }),
  status: text("status").notNull().default("draft"), // draft | scheduled | sending | sent | cancelled | deleted | failed
  totalCount: integer("total_count").notNull().default(0),
  sentCount: integer("sent_count").notNull().default(0),
  failedCount: integer("failed_count").notNull().default(0),
  clickedCount: integer("clicked_count").notNull().default(0),
  lastError: text("last_error"),
  startedAt: timestamp("started_at", { withTimezone: true }),
  finishedAt: timestamp("finished_at", { withTimezone: true }),
  deletedAt: timestamp("deleted_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [index("bc_status_idx").on(t.status, t.scheduledAt)]);

// Знімок отримувачів розсилки: фіксується в момент надсилання чи планування; один рядок = одна людина.
export const broadcastRecipients = pgTable("broadcast_recipients", {
  id: serial("id").primaryKey(),
  broadcastId: integer("broadcast_id").notNull().references(() => broadcasts.id, { onDelete: "cascade" }),
  personId: integer("person_id").notNull().references(() => persons.id, { onDelete: "cascade" }),
  status: text("status").notNull().default("pending"), // pending | sending | sent | failed | deleted
  telegramMessageId: integer("telegram_message_id"),
  extraMessageIds: jsonb("extra_message_ids").$type<number[]>().notNull().default([]),
  error: text("error"),
  attempts: integer("attempts").notNull().default(0),
  claimedAt: timestamp("claimed_at", { withTimezone: true }),
  sentAt: timestamp("sent_at", { withTimezone: true }),
  clickedAt: timestamp("clicked_at", { withTimezone: true }),
  clickedButton: integer("clicked_button"),
  deletedAt: timestamp("deleted_at", { withTimezone: true }),
}, (t) => [uniqueIndex("bcr_uidx").on(t.broadcastId, t.personId), index("bcr_status_idx").on(t.broadcastId, t.status), index("bcr_person_idx").on(t.personId)]);

export const broadcastClicks = pgTable("broadcast_clicks", {
  id: serial("id").primaryKey(),
  broadcastId: integer("broadcast_id").notNull().references(() => broadcasts.id, { onDelete: "cascade" }),
  recipientId: integer("recipient_id").notNull().references(() => broadcastRecipients.id, { onDelete: "cascade" }),
  personId: integer("person_id").notNull(),
  button: integer("button").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [index("bcc_bc_idx").on(t.broadcastId)]);

export const automations = pgTable("automations", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  trigger: text("trigger").notNull(),
  condition: jsonb("condition").$type<Record<string, unknown>>().notNull().default({}),
  delayMinutes: integer("delay_minutes").notNull().default(0),
  action: jsonb("action").$type<Record<string, unknown>>().notNull().default({}),
  isActive: boolean("is_active").notNull().default(false),
  oncePerPerson: boolean("once_per_person").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const syncRuns = pgTable("sync_runs", {
  id: serial("id").primaryKey(),
  kind: text("kind").notNull(), // zenedu_full | zenedu_incremental | webhook
  status: text("status").notNull().default("running"),
  stats: jsonb("stats").$type<Record<string, number>>().notNull().default({}),
  error: text("error"),
  startedAt: timestamp("started_at", { withTimezone: true }).notNull().defaultNow(),
  finishedAt: timestamp("finished_at", { withTimezone: true }),
});

export const settings = pgTable("settings", {
  key: text("key").primaryKey(),
  value: jsonb("value").$type<unknown>(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

// Акаунти панелі: власник і адміністратори. Пароль зберігається як scrypt-хеш, токени запрошень і сесій лише як sha256.
export const users = pgTable("users", {
  id: serial("id").primaryKey(),
  email: text("email").notNull(),
  name: text("name").notNull(),
  role: text("role").notNull().default("admin"), // owner | admin
  passwordHash: text("password_hash"),
  status: text("status").notNull().default("invited"), // invited | active | disabled
  inviteTokenHash: text("invite_token_hash"),
  inviteExpiresAt: timestamp("invite_expires_at", { withTimezone: true }),
  invitePurpose: text("invite_purpose"), // invite | reset
  failedAttempts: integer("failed_attempts").notNull().default(0),
  lockedUntil: timestamp("locked_until", { withTimezone: true }),
  lastLoginAt: timestamp("last_login_at", { withTimezone: true }),
  createdBy: integer("created_by"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [uniqueIndex("users_email_uidx").on(t.email)]);

export const userSessions = pgTable("user_sessions", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  tokenHash: text("token_hash").notNull(),
  ip: text("ip"),
  userAgent: text("user_agent"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  lastSeenAt: timestamp("last_seen_at", { withTimezone: true }).notNull().defaultNow(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  revokedAt: timestamp("revoked_at", { withTimezone: true }),
}, (t) => [uniqueIndex("user_sessions_token_uidx").on(t.tokenHash), index("user_sessions_user_idx").on(t.userId)]);

// Збережені картки: лише токен WayForPay і маска, номер картки Hub не бачить.
export const paymentMethods = pgTable("payment_methods", {
  id: serial("id").primaryKey(),
  personId: integer("person_id").notNull().references(() => persons.id, { onDelete: "cascade" }),
  provider: text("provider").notNull().default("wayforpay"),
  recToken: text("rec_token").notNull(),
  cardPan: text("card_pan"),
  cardType: text("card_type"),
  bank: text("bank"),
  isActive: boolean("is_active").notNull().default(true),
  lastUsedAt: timestamp("last_used_at", { withTimezone: true }),
  failedAt: timestamp("failed_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [uniqueIndex("pm_token_uidx").on(t.personId, t.recToken), index("pm_person_idx").on(t.personId)]);

// Спроби оплати: перший платіж, прив'язка картки, автосписання, повтори, повернення.
export const paymentAttempts = pgTable("payment_attempts", {
  id: serial("id").primaryKey(),
  orderReference: text("order_reference").notNull(),
  personId: integer("person_id").notNull().references(() => persons.id, { onDelete: "cascade" }),
  planId: integer("plan_id").references(() => plans.id),
  subscriptionId: integer("subscription_id"),
  kind: text("kind").notNull(), // first | renewal | manual | card | migrate
  amount: numeric("amount", { precision: 12, scale: 2 }).notNull(),
  currency: text("currency").notNull().default("UAH"),
  status: text("status").notNull().default("pending"), // pending | approved | declined | refunded | expired | error
  mode: text("mode").notNull().default("test"), // test | live
  reasonCode: text("reason_code"),
  reason: text("reason"),
  cardPan: text("card_pan"),
  recToken: text("rec_token"),
  orderId: integer("order_id"),
  raw: jsonb("raw"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  processedAt: timestamp("processed_at", { withTimezone: true }),
}, (t) => [uniqueIndex("pa_ref_uidx").on(t.orderReference), index("pa_person_idx").on(t.personId), index("pa_status_idx").on(t.status, t.createdAt)]);

// Посилання доступу до оффера без оплати (ZenEdu Access links): N людей, до дати, можна рахувати як оплату.
export const accessLinks = pgTable("access_links", {
  id: serial("id").primaryKey(),
  planId: integer("plan_id").notNull().references(() => plans.id, { onDelete: "cascade" }),
  token: text("token").notNull(),
  name: text("name"),
  maxUses: integer("max_uses"),
  usedCount: integer("used_count").notNull().default(0),
  expiresAt: timestamp("expires_at", { withTimezone: true }),
  markAsPayment: boolean("mark_as_payment").notNull().default(false),
  isActive: boolean("is_active").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [uniqueIndex("access_links_token_uidx").on(t.token), index("access_links_plan_idx").on(t.planId)]);
