import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { type InsertUser, users } from "../drizzle/schema";
import { ENV } from "./_core/env";

let client: ReturnType<typeof postgres> | null = null;
let database: ReturnType<typeof drizzle> | null = null;

export function getDb() {
  if (!database && ENV.databaseUrl) {
    client = postgres(ENV.databaseUrl, {
      max: 10,
      idle_timeout: 20,
      connect_timeout: 10,
      prepare: false,
    });
    database = drizzle(client);
  }
  return database;
}

export async function closeDb(): Promise<void> {
  if (client) await client.end({ timeout: 5 });
  client = null;
  database = null;
}

export async function upsertUser(user: InsertUser): Promise<void> {
  if (!user.openId) throw new Error("User openId is required for upsert");
  const db = getDb();
  if (!db) return;
  const role =
    user.role ?? (user.openId === ENV.ownerOpenId ? "admin" : "user");
  const values: InsertUser = {
    ...user,
    role,
    lastSignedIn: user.lastSignedIn ?? new Date(),
    updatedAt: new Date(),
  };
  await db
    .insert(users)
    .values(values)
    .onConflictDoUpdate({
      target: users.openId,
      set: {
        name: values.name ?? null,
        email: values.email ?? null,
        loginMethod: values.loginMethod ?? null,
        role,
        lastSignedIn: values.lastSignedIn,
        updatedAt: new Date(),
      },
    });
}

export async function getUserByOpenId(openId: string) {
  const db = getDb();
  if (!db) return undefined;
  const result = await db
    .select()
    .from(users)
    .where(eq(users.openId, openId))
    .limit(1);
  return result[0];
}
