import { Router } from "express";
import { query } from "../db.js";

// Everything here is the signed-in tech's own tax record: their cars, logbook
// periods, odometer readings and the logbook report. Nobody else sees it.
const router = Router();
const ISO = /^\d{4}-\d{2}-\d{2}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const text = (v, max = 60) => (v == null ? null : String(v).trim().slice(0, max) || null);
const num = (v) => (v == null || v === "" ? null : Number.isFinite(Number(v)) ? Number(v) : NaN);
const today = () => new Date(Date.now() + 24 * 3600 * 1000).toISOString().slice(0, 10);
const r1 = (n) => Math.round(n * 10) / 10;
const MIN_DAYS = 84; // ATO: at least 12 continuous weeks

/** The tech's cars (plus any company cars), with the highest odometer reading on record. */
export async function listVehicles(userId, activeOnly = false) {
  const { rows } = await query(
    `select v.*,
       greatest(
         (select max(end_odo) from trips t where t.vehicle_id = v.id and not t.deleted),
         (select max(odo) from odo_readings r where r.vehicle_id = v.id),
         (select max(greatest(start_odo, coalesce(end_odo, 0))) from logbooks l where l.vehicle_id = v.id)
       ) as last_odo
     from vehicles v
     where (v.owner_id = $1 or v.owner_id is null) ${activeOnly ? "and v.active" : ""}
     order by v.owner_id nulls last, v.name`,
    [userId]
  );
  return rows;
}

async function ownVehicle(userId, id) {
  if (!UUID.test(String(id))) return null;
  const { rows } = await query("select * from vehicles where id = $1 and owner_id = $2", [id, userId]);
  return rows[0] ?? null;
}

function cleanVehicle(b) {
  const v = {
    name: text(b?.name, 40),
    make: text(b?.make),
    model: text(b?.model),
    engine: text(b?.engine, 20),
    rego: text(b?.rego, 12)?.toUpperCase() ?? null,
    is_car: b?.is_car !== false,
  };
  if (!v.make || !v.model) return { error: "Enter the car's make and model." };
  if (!v.engine) return { error: "Enter the engine capacity, e.g. 2.8L. It's on the rego papers." };
  if (!v.rego) return { error: "Enter the registration number." };
  if (!v.name) v.name = `${v.make} ${v.model}`;
  return { value: v };
}

// ----- Cars -----
router.get("/vehicles", async (req, res) => {
  res.json({ vehicles: await listVehicles(req.user.id) });
});

router.post("/vehicles", async (req, res) => {
  const { value, error } = cleanVehicle(req.body);
  if (error) return res.status(400).json({ error });
  const { rows } = await query(
    "insert into vehicles (owner_id, name, make, model, engine, rego, is_car) values ($1,$2,$3,$4,$5,$6,$7) returning *",
    [req.user.id, value.name, value.make, value.model, value.engine, value.rego, value.is_car]
  );
  res.json({ vehicle: rows[0] });
});

router.patch("/vehicles/:id", async (req, res) => {
  const car = await ownVehicle(req.user.id, req.params.id);
  if (!car) return res.status(404).json({ error: "Car not found." });
  if (req.body && "active" in req.body && Object.keys(req.body).length === 1) {
    const { rows } = await query("update vehicles set active = $2 where id = $1 returning *", [car.id, req.body.active === true]);
    return res.json({ vehicle: rows[0] });
  }
  const { value, error } = cleanVehicle({ ...car, ...req.body });
  if (error) return res.status(400).json({ error });
  const { rows } = await query(
    "update vehicles set name=$2, make=$3, model=$4, engine=$5, rego=$6, is_car=$7 where id = $1 returning *",
    [car.id, value.name, value.make, value.model, value.engine, value.rego, value.is_car]
  );
  res.json({ vehicle: rows[0] });
});

// ----- Odometer readings (e.g. 30 June each year) -----
router.get("/readings", async (req, res) => {
  const { rows } = await query("select * from odo_readings where user_id = $1 order by reading_date desc", [req.user.id]);
  res.json({ readings: rows });
});

router.post("/readings", async (req, res) => {
  const car = await ownVehicle(req.user.id, req.body?.vehicle_id);
  if (!car) return res.status(400).json({ error: "Choose one of your cars." });
  const date = String(req.body?.reading_date ?? "");
  const odo = num(req.body?.odo);
  if (!ISO.test(date) || date > today()) return res.status(400).json({ error: "Enter a valid date, not in the future." });
  if (odo == null || Number.isNaN(odo) || odo < 0) return res.status(400).json({ error: "Enter the odometer reading." });
  const { rows } = await query(
    "insert into odo_readings (user_id, vehicle_id, reading_date, odo, note) values ($1,$2,$3,$4,$5) returning *",
    [req.user.id, car.id, date, odo, text(req.body?.note, 120)]
  );
  res.json({ reading: rows[0] });
});

// ----- Logbook periods -----
router.get("/logbooks", async (req, res) => {
  const { rows } = await query(
    `select l.*, v.name as vehicle_name, v.rego as vehicle_rego
     from logbooks l join vehicles v on v.id = l.vehicle_id
     where l.user_id = $1 order by l.start_date desc`,
    [req.user.id]
  );
  res.json({ logbooks: rows });
});

router.post("/logbooks", async (req, res) => {
  const car = await ownVehicle(req.user.id, req.body?.vehicle_id);
  if (!car) return res.status(400).json({ error: "Choose one of your cars." });
  const start_date = String(req.body?.start_date ?? "");
  const start_odo = num(req.body?.start_odo);
  if (!ISO.test(start_date) || start_date > today()) return res.status(400).json({ error: "Enter a valid start date." });
  if (start_odo == null || Number.isNaN(start_odo) || start_odo < 0) return res.status(400).json({ error: "Enter the odometer reading at the start of the period." });
  const open = await query("select 1 from logbooks where vehicle_id = $1 and end_date is null", [car.id]);
  if (open.rowCount) return res.status(400).json({ error: "This car already has a logbook period running. Finish that one first." });
  const { rows } = await query(
    "insert into logbooks (user_id, vehicle_id, start_date, start_odo) values ($1,$2,$3,$4) returning *",
    [req.user.id, car.id, start_date, start_odo]
  );
  res.json({ logbook: rows[0] });
});

router.patch("/logbooks/:id", async (req, res) => {
  if (!UUID.test(req.params.id)) return res.status(404).json({ error: "Logbook not found." });
  const { rows: found } = await query("select * from logbooks where id = $1 and user_id = $2", [req.params.id, req.user.id]);
  const l = found[0];
  if (!l) return res.status(404).json({ error: "Logbook not found." });
  const end_date = req.body?.end_date ? String(req.body.end_date) : null;
  const end_odo = num(req.body?.end_odo);
  if (end_date === null && end_odo === null) {
    const { rows } = await query("update logbooks set end_date = null, end_odo = null, updated_at = now() where id = $1 returning *", [l.id]);
    return res.json({ logbook: rows[0] });
  }
  if (!ISO.test(end_date) || end_date < l.start_date || end_date > today()) return res.status(400).json({ error: "Enter a valid end date, on or after the start date." });
  if (end_odo == null || Number.isNaN(end_odo) || end_odo < l.start_odo) return res.status(400).json({ error: "The closing odometer must be at least the opening reading." });
  const { rows } = await query("update logbooks set end_date = $2, end_odo = $3, updated_at = now() where id = $1 returning *", [l.id, end_date, end_odo]);
  res.json({ logbook: rows[0] });
});

// ----- The logbook report -----
const VAGUE = /^(work|business|job|jobs|site|travel|trip|drive|driving|client|customer|n\/?a)$/i;

export async function buildReport(userId, logbookId) {
  const { rows: ls } = await query("select * from logbooks where id = $1 and user_id = $2", [logbookId, userId]);
  const l = ls[0];
  if (!l) return null;
  const { rows: vs } = await query("select * from vehicles where id = $1", [l.vehicle_id]);
  const vehicle = vs[0];
  const endDate = l.end_date ?? today();
  const { rows: trips } = await query(
    `select * from trips where user_id = $1 and vehicle_id = $2 and not deleted
       and trip_date >= $3 and trip_date <= $4
     order by start_odo nulls last, trip_date, started_at nulls last`,
    [userId, l.vehicle_id, l.start_date, endDate]
  );
  const { rows: readings } = await query(
    "select * from odo_readings where vehicle_id = $1 and reading_date >= $2 order by reading_date",
    [l.vehicle_id, l.start_date]
  );

  const withOdo = trips.filter((t) => t.start_odo != null && t.end_odo != null);
  const missingOdo = trips.filter((t) => t.start_odo == null || t.end_odo == null);

  // Walk the odometer: anything between one trip's end and the next trip's start wasn't logged.
  const gaps = [];
  const overlaps = [];
  let pos = l.start_odo;
  for (const t of withOdo) {
    if (t.start_odo - pos > 0.5) gaps.push({ from_odo: pos, to_odo: t.start_odo, km: r1(t.start_odo - pos), before_date: t.trip_date });
    else if (pos - t.start_odo > 0.5) overlaps.push({ trip_id: t.id, trip_date: t.trip_date, start_odo: t.start_odo, expected_from: pos });
    pos = Math.max(pos, t.end_odo);
  }
  const closingOdo = l.end_odo ?? pos;
  if (l.end_odo != null && l.end_odo - pos > 0.5) gaps.push({ from_odo: pos, to_odo: l.end_odo, km: r1(l.end_odo - pos), before_date: l.end_date });

  const sum = (list) => r1(list.reduce((s, t) => s + Number(t.km), 0));
  const business = withOdo.filter((t) => t.trip_type === "business");
  const privateTrips = withOdo.filter((t) => t.trip_type === "private");
  const totalKm = r1(closingOdo - l.start_odo);
  const businessKm = sum(business);
  const privateKm = sum(privateTrips);
  const unloggedKm = r1(gaps.reduce((s, g) => s + g.km, 0));
  const businessPct = totalKm > 0 ? Math.round((businessKm / totalKm) * 1000) / 10 : null;
  const days = Math.round((new Date(endDate) - new Date(l.start_date)) / 86400000) + 1;

  const warnings = [];
  if (!l.end_date) warnings.push(`This period is still running (day ${days}). Finish it with a closing odometer reading once it has covered at least 12 weeks.`);
  else if (days < MIN_DAYS) warnings.push(`The period is ${days} days. The ATO requires at least 12 continuous weeks (84 days).`);
  if (gaps.length) warnings.push(`${unloggedKm.toLocaleString("en-AU")} km across ${gaps.length} gap${gaps.length > 1 ? "s" : ""} weren't logged. They count as non-business kms. During a logbook period, log every trip, including private ones.`);
  if (overlaps.length) warnings.push(`${overlaps.length} trip${overlaps.length > 1 ? "s start" : " starts"} below the previous trip's closing odometer. Check those readings.`);
  if (missingOdo.length) warnings.push(`${missingOdo.length} trip${missingOdo.length > 1 ? "s are" : " is"} missing odometer readings and ${missingOdo.length > 1 ? "aren't" : "isn't"} counted.`);
  const vague = business.filter((t) => !t.job_no && (!t.purpose || t.purpose.trim().length < 5 || VAGUE.test(t.purpose.trim())));
  if (vague.length) warnings.push(`${vague.length} business trip${vague.length > 1 ? "s have" : " has"} a vague reason. Add the job, client or site so the purpose is clear.`);
  if (!vehicle.make || !vehicle.model || !vehicle.engine || !vehicle.rego) warnings.push("The car's make, model, engine capacity or registration is missing.");
  if (!vehicle.is_car) warnings.push("This vehicle is marked as carrying 1 tonne or more, or 9 or more passengers. The ATO's car logbook and cents-per-km methods apply to cars. Check with your accountant how to claim for this vehicle.");

  return {
    logbook: l,
    vehicle,
    trips,
    readings,
    gaps,
    overlaps,
    totals: { days, total_km: totalKm, business_km: businessKm, private_km: privateKm, unlogged_km: unloggedKm, business_pct: businessPct, closing_odo: closingOdo },
    vague_ids: vague.map((t) => t.id),
    warnings,
  };
}

router.get("/logbooks/:id/report", async (req, res) => {
  if (!UUID.test(req.params.id)) return res.status(404).json({ error: "Logbook not found." });
  const report = await buildReport(req.user.id, req.params.id);
  if (!report) return res.status(404).json({ error: "Logbook not found." });
  res.json({ report });
});

// All of the tech's own trips for a date range (their full record, private included)
router.get("/trips", async (req, res) => {
  const { from, to } = req.query;
  if (!ISO.test(String(from)) || !ISO.test(String(to))) return res.status(400).json({ error: "from and to dates are required." });
  const { rows } = await query(
    "select * from trips where user_id = $1 and not deleted and trip_date between $2 and $3 order by trip_date, start_odo nulls last",
    [req.user.id, from, to]
  );
  res.json({ trips: rows });
});

export default router;
