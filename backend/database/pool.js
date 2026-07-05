// Single shared PostgreSQL connection pool for the whole backend.
// Every query in the app should go through this pool (directly, or via the model files
// in backend/models/) rather than opening ad-hoc connections.

import "dotenv/config";
import { Pool } from "pg";

if (!process.env.DATABASE_URL) {
  throw new Error(
    "DATABASE_URL is not set. Copy .env.example to .env and fill in your PostgreSQL connection string."
  );
}

// Most hosted Postgres providers (Render, Supabase, Railway, RDS) require SSL for external
// connections but use a self-signed/managed cert chain that Node won't trust by default.
// rejectUnauthorized: false is the standard, accepted setting for this — it still encrypts
// the connection, it just doesn't verify the certificate chain. Local/Docker Postgres
// connections (no SSL) are unaffected because ssl is only attached when DB_SSL=true.
const useSsl = process.env.DB_SSL === "true";

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: useSsl ? { rejectUnauthorized: false } : false,
  max: Number(process.env.DB_POOL_MAX || 10),
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 5000
});

pool.on("error", (error) => {
  // Catches errors on idle connections in the pool (e.g. the DB restarting) so they don't
  // crash the whole process — without this handler, an idle connection error is uncaught.
  console.error("Unexpected PostgreSQL pool error:", error.message);
});

export default pool;
