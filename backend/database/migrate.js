// Minimal, dependency-free migration runner.
// Run with: npm run migrate
//
// How it works:
//   1. Ensures a schema_migrations tracking table exists.
//   2. Reads every *.sql file in this folder, sorted by filename (hence the 000_, 001_, 002_ prefixes).
//   3. Skips any file already recorded in schema_migrations.
//   4. Runs each remaining file inside its own transaction, then records it as applied.
//
// This is intentionally simple — no migration framework dependency — so it's easy to read,
// audit, and extend as the schema grows. Add new files as 004_..., 005_..., etc.

import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import pool from "./pool.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_DIR = join(__dirname, "migrations");

async function ensureMigrationsTable(client) {
  await client.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      filename    VARCHAR(255) PRIMARY KEY,
      applied_at  TIMESTAMPTZ NOT NULL DEFAULT now()
    );
  `);
}

async function getAppliedMigrations(client) {
  const { rows } = await client.query("SELECT filename FROM schema_migrations");
  return new Set(rows.map((row) => row.filename));
}

async function runMigrations() {
  const client = await pool.connect();
  try {
    await ensureMigrationsTable(client);
    const applied = await getAppliedMigrations(client);

    const files = readdirSync(MIGRATIONS_DIR)
      .filter((file) => file.endsWith(".sql") && file !== "000_schema_migrations.sql")
      .sort();

    let ranCount = 0;
    for (const file of files) {
      if (applied.has(file)) {
        console.log(`  skip  ${file} (already applied)`);
        continue;
      }
      const sql = readFileSync(join(MIGRATIONS_DIR, file), "utf8");
      console.log(`  run   ${file}`);
      try {
        await client.query("BEGIN");
        await client.query(sql);
        await client.query("INSERT INTO schema_migrations (filename) VALUES ($1)", [file]);
        await client.query("COMMIT");
        ranCount += 1;
      } catch (error) {
        await client.query("ROLLBACK");
        throw new Error(`Migration ${file} failed: ${error.message}`);
      }
    }

    if (ranCount === 0) {
      console.log("\nNo new migrations to run. Database is up to date.");
    } else {
      console.log(`\nRan ${ranCount} migration(s) successfully.`);
    }
  } finally {
    client.release();
    await pool.end();
  }
}

runMigrations().catch((error) => {
  console.error("Migration failed:", error.message);
  process.exit(1);
});
