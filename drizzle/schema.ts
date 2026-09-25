import {
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  serial,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";

export const userRole = pgEnum("user_role", ["user", "admin"]);
export const analysisStatus = pgEnum("analysis_status", [
  "queued",
  "running",
  "completed",
  "failed",
]);

export const users = pgTable(
  "users",
  {
    id: serial("id").primaryKey(),
    openId: varchar("open_id", { length: 128 }).notNull(),
    name: text("name"),
    email: varchar("email", { length: 320 }),
    loginMethod: varchar("login_method", { length: 64 }),
    role: userRole("role").default("user").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    lastSignedIn: timestamp("last_signed_in", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  table => [uniqueIndex("users_open_id_uq").on(table.openId)]
);

export const eventLogs = pgTable(
  "event_logs",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    ownerId: integer("owner_id")
      .references(() => users.id, { onDelete: "cascade" })
      .notNull(),
    name: varchar("name", { length: 240 }).notNull(),
    format: varchar("format", { length: 12 }).notNull(),
    sourceHash: varchar("source_hash", { length: 128 }).notNull(),
    eventCount: integer("event_count").notNull(),
    caseCount: integer("case_count").notNull(),
    qualityReport: jsonb("quality_report").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  table => [
    uniqueIndex("event_logs_owner_hash_uq").on(table.ownerId, table.sourceHash),
    index("event_logs_owner_created_idx").on(table.ownerId, table.createdAt),
  ]
);

export const processEvents = pgTable(
  "process_events",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    logId: uuid("log_id")
      .references(() => eventLogs.id, { onDelete: "cascade" })
      .notNull(),
    caseId: varchar("case_id", { length: 240 }).notNull(),
    activity: varchar("activity", { length: 240 }).notNull(),
    eventTime: timestamp("event_time", { withTimezone: true }).notNull(),
    resource: varchar("resource", { length: 240 }),
    lifecycle: varchar("lifecycle", { length: 32 }),
    attributes: jsonb("attributes").notNull().default({}),
    sequence: integer("sequence").notNull(),
  },
  table => [
    index("process_events_log_case_sequence_idx").on(
      table.logId,
      table.caseId,
      table.sequence
    ),
    index("process_events_log_activity_time_idx").on(
      table.logId,
      table.activity,
      table.eventTime
    ),
  ]
);

export const analysisRuns = pgTable(
  "analysis_runs",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    logId: uuid("log_id")
      .references(() => eventLogs.id, { onDelete: "cascade" })
      .notNull(),
    engineVersion: varchar("engine_version", { length: 32 }).notNull(),
    status: analysisStatus("status").default("queued").notNull(),
    config: jsonb("config").notNull().default({}),
    summary: jsonb("summary"),
    evidence: jsonb("evidence"),
    errorCode: varchar("error_code", { length: 80 }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    completedAt: timestamp("completed_at", { withTimezone: true }),
  },
  table => [
    index("analysis_runs_log_created_idx").on(table.logId, table.createdAt),
  ]
);

export const investigationSteps = pgTable(
  "investigation_steps",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    analysisRunId: uuid("analysis_run_id")
      .references(() => analysisRuns.id, { onDelete: "cascade" })
      .notNull(),
    sequence: integer("sequence").notNull(),
    tool: varchar("tool", { length: 80 }).notNull(),
    status: varchar("status", { length: 24 }).notNull(),
    input: jsonb("input").notNull(),
    evidenceIds: jsonb("evidence_ids").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  table => [
    uniqueIndex("investigation_steps_run_sequence_uq").on(
      table.analysisRunId,
      table.sequence
    ),
  ]
);

export type User = typeof users.$inferSelect;
export type InsertUser = typeof users.$inferInsert;
