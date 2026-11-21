import { execSync } from "node:child_process";
import "dotenv/config";

/** Points tests at TEST_DATABASE_URL and applies migrations once before the run. */
export default function setup() {
  const url = process.env.TEST_DATABASE_URL;
  if (!url) throw new Error("TEST_DATABASE_URL must be set for tests");
  process.env.DATABASE_URL = url;
  execSync("npx prisma migrate deploy", { stdio: "inherit", env: { ...process.env, DATABASE_URL: url } });
}
