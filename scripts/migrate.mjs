// Застосовує міграції drizzle перед збіркою, якщо є DATABASE_URL (на Vercel — після підключення Neon).
import { spawnSync } from "node:child_process";
if (!process.env.DATABASE_URL) { console.log("[migrate] DATABASE_URL відсутній, міграції пропущено"); process.exit(0); }
const r = spawnSync("npx", ["drizzle-kit", "migrate"], { stdio: "inherit", env: process.env });
process.exit(r.status ?? 1);
