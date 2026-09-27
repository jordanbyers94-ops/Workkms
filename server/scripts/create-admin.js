// Create the first office admin.
// Usage (from the repo root, linked to your Railway project):
//   railway run node server/scripts/create-admin.js --code jordan --name "Your Name"
import readline from "node:readline/promises";
import { stdin, stdout } from "node:process";
import { CODE_RE, hashSecret } from "../src/auth.js";
import { migrate, pool, query } from "../src/db.js";

const arg = (k) => { const i = process.argv.indexOf(`--${k}`); return i > 0 ? process.argv[i + 1] : undefined; };
const code = String(arg("code") ?? "").trim().toLowerCase();
const name = String(arg("name") ?? "").trim();
if (!CODE_RE.test(code) || !name) {
  console.error('Usage: node server/scripts/create-admin.js --code yourcode --name "Your Name"');
  process.exit(1);
}
const rl = readline.createInterface({ input: stdin, output: stdout });
const pw = await rl.question("Password (at least 10 characters): ");
rl.close();
if (pw.length < 10) { console.error("Password is too short."); process.exit(1); }

await migrate();
await query(
  `insert into staff (full_name, staff_code, role, secret_hash) values ($1,$2,'admin',$3)
   on conflict (staff_code) do update set role = 'admin', active = true, secret_hash = excluded.secret_hash,
     token_version = staff.token_version + 1, failed_logins = 0, locked_until = null`,
  [name, code, await hashSecret(pw)]
);
console.log(`Admin "${code}" is ready. Sign in to the dashboard with that staff code and password.`);
await pool.end();
