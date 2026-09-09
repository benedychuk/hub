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

// Тариф.
export const plans = pgTable("plans", {
  id: serial("id").primaryKey(),
  key: text("key").notNull().unique(),
  name: text("name").notNull(),
  price: numeric("price", { precision: 12, scale: 2 }).notNull(),
  currency: text("currency").notNull().default("UAH"),
  period: text("period").notNull().default("month"), // month | quarter | year
  trialDays: integer("trial_days").notNull().default(0),
  trialPrice: numeric("trial_price", { precision: 12, scale: 2 }),
  entitlements: jsonb("entitlements").$type<Record<string, string>>().notNull().default({}), // key -> quota/label
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
  status: text("status").notNull().default("active"), // trialing | active | past_due | paused | cancelled | expired
  price: numeric("price", { precision: 12, scale: 2 }).notNull().default("0"),
  currency: text("currency").notNull().default("UAH"),
  periodDays: integer("period_days").notNull().default(31),
  currentPeriodEnd: timestamp("current_period_end", { withTimezone: true }),
  cancelAtPeriodEnd: boolean("cancel_at_period_end").notNull().default(false),
  startedAt: timestamp("started_at", { withTimezone: true }),
  lastPaymentAt: timestamp("last_payment_at", { withTimezone: true }),
  paymentsCount: integer("payments_count").notNull().default(0),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [uniqueIndex("subs_person_source_uidx").on(t.personId, t.source), index("subs_status_idx").on(t.status)]);

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
  name: text("name").notNull(),
  sortOrder: integer("sort_order").notNull().default(0),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

// Воронки (структура як у ZenEdu; імпорт із ZenEdu + власні).
export const funnels = pgTable("funnels", {
  id: serial("id").primaryKey(),
  source: text("source").notNull().default("hub"),
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

export const broadcasts = pgTable("broadcasts", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  botKey: text("bot_key").notNull().default("hub"),
  audience: jsonb("audience").$type<Record<string, unknown>>().notNull().default({}),
  text: text("text").notNull(),
  buttons: jsonb("buttons").$type<{ text: string; url?: string }[]>().notNull().default([]),
  protectContent: boolean("protect_content").notNull().default(false),
  disablePreview: boolean("disable_preview").notNull().default(true),
  scheduledAt: timestamp("scheduled_at", { withTimezone: true }),
  status: text("status").notNull().default("draft"), // draft | scheduled | sending | sent | failed
  sentCount: integer("sent_count").notNull().default(0),
  failedCount: integer("failed_count").notNull().default(0),
  lastError: text("last_error"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

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
