import pg from "pg";
import { readFile } from "node:fs/promises";

// Return numerics as numbers and dates as plain YYYY-MM-DD strings
pg.types.setTypeParser(1700, (v) => (v === null ? null : parseFloat(v)));
pg.types.setTypeParser(1082, (v) => v);

if (!process.env.DATABASE_URL) {
  console.error("DATABASE_URL is not set. Add a Postgres database in Railway and reference its DATABASE_URL.");
  process.exit(1);
}

export const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL,
  // Railway's private network doesn't use SSL; the public proxy URL does.
  ssl: process.env.DATABASE_SSL === "true" ? { rejectUnauthorized: false } : false,
  max: 10,
});

export const query = (text, params) => pool.query(text, params);

export async function migrate() {
  const sql = await readFile(new URL("./schema.sql", import.meta.url), "utf8");
  await pool.query(sql);
}
