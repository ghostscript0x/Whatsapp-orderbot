import "dotenv/config";

// Runs in each test worker before modules load, so lib/prisma connects to the test DB.
if (!process.env.TEST_DATABASE_URL) throw new Error("TEST_DATABASE_URL must be set for tests");
process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
