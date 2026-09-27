import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { query } from "./db.js";

const SECRET = process.env.JWT_SECRET;
if (!SECRET || SECRET.length < 32) {
  console.error("JWT_SECRET must be set to a random string of at least 32 characters.");
  process.exit(1);
}

export const CODE_RE = /^[a-z0-9._-]{2,24}$/;
export const secretOk = (s, role) => (role === "admin" ? typeof s === "string" && s.length >= 10 : /^\d{6}$/.test(String(s)));
export const secretMsg = (role) => (role === "admin" ? "Admin passwords need at least 10 characters." : "PIN must be exactly 6 digits.");
export const hashSecret = (s) => bcrypt.hash(String(s), 11);

// Techs stay signed in offline for 60 days, like the audit tool. Admin sessions are short.
export const signToken = (u) =>
  jwt.sign({ sub: u.id, tv: u.token_version, role: u.role }, SECRET, { expiresIn: u.role === "admin" ? "12h" : "60d" });

export const publicProfile = (u) => ({ id: u.id, full_name: u.full_name, staff_code: u.staff_code, role: u.role, active: u.active });

const DUMMY_HASH = bcrypt.hashSync("timing-safe-dummy", 11);
const MAX_FAILS = 5;
const LOCK_MINUTES = 15;

export async function login(staffCode, secret) {
  const code = String(staffCode || "").trim().toLowerCase();
  const { rows } = await query("select * from staff where staff_code = $1", [code]);
  const u = rows[0];
  if (!u) {
    await bcrypt.compare(String(secret || ""), DUMMY_HASH); // same timing as a real check
    return { status: 401, error: "Staff code or PIN is wrong." };
  }
  if (u.locked_until && new Date(u.locked_until) > new Date()) {
    return { status: 429, error: `Too many wrong attempts. Try again in ${LOCK_MINUTES} minutes or ask the office to reset your PIN.` };
  }
  const ok = await bcrypt.compare(String(secret || ""), u.secret_hash);
  if (!ok) {
    const fails = u.failed_logins + 1;
    if (fails >= MAX_FAILS) {
      await query("update staff set failed_logins = 0, locked_until = now() + make_interval(mins => $2) where id = $1", [u.id, LOCK_MINUTES]);
    } else {
      await query("update staff set failed_logins = $2 where id = $1", [u.id, fails]);
    }
    return { status: 401, error: "Staff code or PIN is wrong." };
  }
  if (!u.active) return { status: 403, error: "This account has been deactivated. Talk to the office." };
  await query("update staff set failed_logins = 0, locked_until = null where id = $1", [u.id]);
  return { status: 200, token: signToken(u), profile: publicProfile(u) };
}

export async function requireAuth(req, res, next) {
  const m = (req.headers.authorization || "").match(/^Bearer (.+)$/);
  if (!m) return res.status(401).json({ error: "Sign in again." });
  let payload;
  try {
    payload = jwt.verify(m[1], SECRET);
  } catch {
    return res.status(401).json({ error: "Your session has expired. Sign in again." });
  }
  const { rows } = await query(
    "select id, full_name, staff_code, role, active, token_version from staff where id = $1",
    [payload.sub]
  );
  const u = rows[0];
  if (!u || !u.active || u.token_version !== payload.tv) return res.status(401).json({ error: "Sign in again." });
  req.user = u;
  next();
}

export const requireAdmin = (req, res, next) =>
  req.user?.role === "admin" ? next() : res.status(403).json({ error: "Only office admins can do that." });
