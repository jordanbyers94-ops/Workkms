import { Router } from "express";
import { query } from "../db.js";
import { CODE_RE, hashSecret, requireAdmin, secretMsg, secretOk } from "../auth.js";

const router = Router();
router.use(requireAdmin);

const ISO = /^\d{4}-\d{2}-\d{2}$/;
const staffCols = "id, full_name, staff_code, role, active, created_at";

// ----- Trips -----
router.get("/trips", async (req, res) => {
  const { from, to } = req.query;
  if (!ISO.test(String(from)) || !ISO.test(String(to))) return res.status(400).json({ error: "from and to dates are required." });
  // Private trips in techs' own cars are theirs alone; the office only sees business trips.
  const { rows } = await query(
    "select * from trips where trip_type = 'business' and trip_date between $1 and $2 order by trip_date desc, started_at desc nulls last",
    [from, to]
  );
  res.json({ trips: rows });
});

// ----- Staff -----
router.get("/staff", async (_req, res) => {
  const { rows } = await query(`select ${staffCols} from staff order by full_name`);
  res.json({ staff: rows });
});

router.post("/staff", async (req, res) => {
  const full_name = String(req.body?.full_name ?? "").trim();
  const staff_code = String(req.body?.staff_code ?? "").trim().toLowerCase();
  const role = req.body?.role === "admin" ? "admin" : "tech";
  const secret = String(req.body?.secret ?? "");
  if (!full_name) return res.status(400).json({ error: "Enter the person's name." });
  if (!CODE_RE.test(staff_code)) return res.status(400).json({ error: "Staff code must be 2–24 letters or numbers with no spaces." });
  if (!secretOk(secret, role)) return res.status(400).json({ error: secretMsg(role) });
  try {
    const { rows } = await query(
      `insert into staff (full_name, staff_code, role, secret_hash) values ($1,$2,$3,$4) returning ${staffCols}`,
      [full_name, staff_code, role, await hashSecret(secret)]
    );
    res.json({ staff: rows[0] });
  } catch (e) {
    if (e.code === "23505") return res.status(400).json({ error: "That staff code is already taken." });
    throw e;
  }
});

router.post("/staff/:id/reset", async (req, res) => {
  const { rows } = await query("select role from staff where id = $1", [req.params.id]);
  if (!rows[0]) return res.status(404).json({ error: "Staff member not found." });
  const secret = String(req.body?.secret ?? "");
  if (!secretOk(secret, rows[0].role)) return res.status(400).json({ error: secretMsg(rows[0].role) });
  // New PIN signs them out of any other phone, and clears any lockout.
  await query(
    "update staff set secret_hash = $2, token_version = token_version + 1, failed_logins = 0, locked_until = null where id = $1",
    [req.params.id, await hashSecret(secret)]
  );
  res.json({ ok: true });
});

router.post("/staff/:id/active", async (req, res) => {
  const active = req.body?.active === true;
  if (req.params.id === req.user.id && !active) return res.status(400).json({ error: "You can't deactivate your own account." });
  const { rowCount } = await query("update staff set active = $2, token_version = token_version + 1 where id = $1", [req.params.id, active]);
  if (!rowCount) return res.status(404).json({ error: "Staff member not found." });
  res.json({ ok: true });
});

// ----- Vehicles -----
router.get("/vehicles", async (_req, res) => {
  const { rows } = await query("select * from vehicles order by owner_id nulls first, name");
  res.json({ vehicles: rows });
});
router.post("/vehicles", async (req, res) => {
  const name = String(req.body?.name ?? "").trim();
  const rego = String(req.body?.rego ?? "").trim().toUpperCase() || null;
  if (!name) return res.status(400).json({ error: "Enter a vehicle name." });
  const { rows } = await query("insert into vehicles (name, rego) values ($1,$2) returning *", [name, rego]);
  res.json({ vehicle: rows[0] });
});
router.patch("/vehicles/:id", async (req, res) => {
  const { rows } = await query("update vehicles set active = $2 where id = $1 returning *", [req.params.id, req.body?.active === true]);
  if (!rows[0]) return res.status(404).json({ error: "Vehicle not found." });
  res.json({ vehicle: rows[0] });
});

// ----- Settings -----
router.put("/settings", async (req, res) => {
  const rate = Number(req.body?.rate_per_km);
  const ato = Number(req.body?.ato_rate);
  const company = String(req.body?.company_name ?? "").trim() || "Work kms";
  if (!Number.isFinite(rate) || rate < 0 || rate > 10) return res.status(400).json({ error: "Enter a pay rate between $0 and $10." });
  if (!Number.isFinite(ato) || ato < 0 || ato > 10) return res.status(400).json({ error: "Enter an ATO rate between $0 and $10." });
  const { rows } = await query(
    "update settings set rate_per_km = $1, company_name = $2, ato_rate = $3 where id = 1 returning company_name, rate_per_km, ato_rate",
    [rate, company, ato]
  );
  res.json({ settings: rows[0] });
});

export default router;
