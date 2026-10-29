import { sql } from "drizzle-orm";
import { integer, sqliteTable, text, index, primaryKey, uniqueIndex } from "drizzle-orm/sqlite-core";

const timestamps = {
  createdAt: integer("created_at", { mode: "timestamp_ms" })
    .notNull()
    .default(sql`(unixepoch() * 1000)`),
  updatedAt: integer("updated_at", { mode: "timestamp_ms" })
    .notNull()
    .default(sql`(unixepoch() * 1000)`)
    .$onUpdate(() => new Date()),
};

/* ---------- Better Auth tables (names/fields must match Better Auth's model) ---------- */

export const user = sqliteTable("user", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  // Telegram gives no email; telegram users get a placeholder under .invalid
  email: text("email").notNull().unique(),
  emailVerified: integer("email_verified", { mode: "boolean" }).notNull().default(false),
  image: text("image"),
  role: text("role").notNull().default("member"),
  telegramId: text("telegram_id").unique(),
  telegramUsername: text("telegram_username"),
  // Executive position (chair, vice chair, secretary); access comes from `role`
  position: text("position", { enum: ["chair", "vice_chair", "secretary"] }),
  ...timestamps,
});

export const session = sqliteTable(
  "session",
  {
    id: text("id").primaryKey(),
    expiresAt: integer("expires_at", { mode: "timestamp_ms" }).notNull(),
    token: text("token").notNull().unique(),
    ipAddress: text("ip_address"),
    userAgent: text("user_agent"),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    ...timestamps,
  },
  (t) => [index("session_user_idx").on(t.userId)],
);

export const account = sqliteTable(
  "account",
  {
    id: text("id").primaryKey(),
    accountId: text("account_id").notNull(),
    providerId: text("provider_id").notNull(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    accessToken: text("access_token"),
    refreshToken: text("refresh_token"),
    idToken: text("id_token"),
    accessTokenExpiresAt: integer("access_token_expires_at", { mode: "timestamp_ms" }),
    refreshTokenExpiresAt: integer("refresh_token_expires_at", { mode: "timestamp_ms" }),
    scope: text("scope"),
    password: text("password"),
    ...timestamps,
  },
  (t) => [index("account_user_idx").on(t.userId)],
);

export const verification = sqliteTable("verification", {
  id: text("id").primaryKey(),
  identifier: text("identifier").notNull(),
  value: text("value").notNull(),
  expiresAt: integer("expires_at", { mode: "timestamp_ms" }).notNull(),
  ...timestamps,
});

/* ---------- Fellowship tables ---------- */

export const members = sqliteTable(
  "members",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    // One member record per login
    userId: text("user_id")
      .notNull()
      .unique()
      .references(() => user.id, { onDelete: "cascade" }),
    fullName: text("full_name").notNull(),
    christianName: text("christian_name"),
    gender: text("gender", { enum: ["male", "female"] }).notNull(),
    phone: text("phone").notNull(),
    studentId: text("student_id").notNull(),
    fieldOfStudy: text("field_of_study").notNull(),
    yearOfStudy: integer("year_of_study").notNull(),
    contentLanguage: text("content_language", { enum: ["om", "am"] }).notNull(),
    note: text("note"),
    status: text("status", { enum: ["pending", "active", "rejected", "alumni"] })
      .notNull()
      .default("pending"),
    reviewedBy: text("reviewed_by").references(() => user.id, { onDelete: "set null" }),
    reviewedAt: integer("reviewed_at", { mode: "timestamp_ms" }),
    ...timestamps,
  },
  (t) => [index("members_status_idx").on(t.status)],
);

export type Member = typeof members.$inferSelect;

/**
 * Phone numbers members shared with the bot ("Share my phone number").
 * Telegram guarantees the number belongs to that Telegram account, so the
 * registration form uses it instead of asking. Keyed by Telegram id because
 * people share their number before they have ever opened the website.
 */
export const telegramContacts = sqliteTable("telegram_contacts", {
  telegramId: text("telegram_id").primaryKey(),
  phone: text("phone").notNull(),
  firstName: text("first_name"),
  username: text("username"),
  ...timestamps,
});

export type TelegramContact = typeof telegramContacts.$inferSelect;

/* ---------- Departments & attendance ---------- */

export const departments = sqliteTable("departments", {
  id: text("id").primaryKey(), // short slug, e.g. "faaruu"
  nameOm: text("name_om").notNull(),
  nameAm: text("name_am").notNull(),
  sortOrder: integer("sort_order").notNull().default(0),
  ...timestamps,
});

export const departmentMembers = sqliteTable(
  "department_members",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    departmentId: text("department_id")
      .notNull()
      .references(() => departments.id, { onDelete: "cascade" }),
    memberId: text("member_id")
      .notNull()
      .references(() => members.id, { onDelete: "cascade" }),
    role: text("role", { enum: ["member", "leader"] }).notNull().default("member"),
    status: text("status", { enum: ["pending", "active", "rejected"] }).notNull().default("pending"),
    ...timestamps,
  },
  (t) => [uniqueIndex("dept_member_unique").on(t.departmentId, t.memberId), index("dept_member_member_idx").on(t.memberId)],
);

/** departmentId null = whole-fellowship session (taken by admins) */
export const attendanceSessions = sqliteTable(
  "attendance_sessions",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    departmentId: text("department_id").references(() => departments.id, { onDelete: "cascade" }),
    title: text("title").notNull(),
    date: text("date").notNull(), // YYYY-MM-DD
    createdBy: text("created_by").references(() => user.id, { onDelete: "set null" }),
    ...timestamps,
  },
  (t) => [index("attendance_sessions_dept_date_idx").on(t.departmentId, t.date)],
);

export const attendanceRecords = sqliteTable(
  "attendance_records",
  {
    sessionId: text("session_id")
      .notNull()
      .references(() => attendanceSessions.id, { onDelete: "cascade" }),
    memberId: text("member_id")
      .notNull()
      .references(() => members.id, { onDelete: "cascade" }),
    status: text("status", { enum: ["present", "absent", "excused"] }).notNull(),
    recordedBy: text("recorded_by").references(() => user.id, { onDelete: "set null" }),
    ...timestamps,
  },
  (t) => [primaryKey({ columns: [t.sessionId, t.memberId] }), index("attendance_records_member_idx").on(t.memberId)],
);

export type Department = typeof departments.$inferSelect;
