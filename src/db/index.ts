import { neon } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-http";
import * as schema from "./schema";

export const hasDb = () => Boolean(process.env.DATABASE_URL);

let _db: ReturnType<typeof drizzle<typeof schema>> | null = null;

export function db() {
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is not set");
  if (!_db) _db = drizzle(neon(process.env.DATABASE_URL), { schema });
  return _db;
}

export { schema };
