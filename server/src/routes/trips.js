import { Router } from "express";
import { query } from "../db.js";

const router = Router();
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ISO = /^\d{4}-\d{2}-\d{2}$/;

const text = (v) => (v == null ? null : String(v).trim().slice(0, 200) || null);
const numOrNull = (v) => (v == null || v === "" ? null : Number.isFinite(Number(v)) ? Number(v) : NaN);
const tsOrNull = (v) => (v == null ? null : Number.isNaN(Date.parse(v)) ? NaN : new Date(v).toISOString());

function today() {
  // Allow a day of slack for time zones
  const d = new Date(Date.now() + 24 * 3600 * 1000);
  return d.toISOString().slice(0, 10);
}

export function cleanTrip(t) {
  if (!t || typeof t !== "object") return { error: "Not a trip." };
  if (!UUID.test(String(t.id))) return { error: "Bad trip id." };
  if (!ISO.test(String(t.trip_date)) || t.trip_date > today()) return { error: "Bad date." };
  if (!["gps", "odometer", "manual"].includes(t.source)) return { error: "Bad source." };
  const trip_type = t.trip_type === "private" ? "private" : "business";
  const end_date = t.end_date == null || t.end_date === "" ? t.trip_date : String(t.end_date);
  if (!ISO.test(end_date) || end_date < t.trip_date || end_date > today()) return { error: "Bad end date." };
  const v = {
    id: String(t.id).toLowerCase(),
    vehicle_id: t.vehicle_id && UUID.test(String(t.vehicle_id)) ? String(t.vehicle_id) : null,
    trip_date: t.trip_date,
    end_date,
    trip_type,
    started_at: tsOrNull(t.started_at),
    ended_at: tsOrNull(t.ended_at),
    km: numOrNull(t.km),
    start_odo: numOrNull(t.start_odo),
    end_odo: numOrNull(t.end_odo),
    source: t.source,
    gps_km: numOrNull(t.gps_km),
    from_text: text(t.from_text),
    to_text: text(t.to_text),
    job_no: trip_type === "business" ? text(t.job_no) : null,
    purpose: text(t.purpose),
    // Private trips never keep location
    start_lat: trip_type === "business" ? numOrNull(t.start_lat) : null,
    start_lng: trip_type === "business" ? numOrNull(t.start_lng) : null,
    end_lat: trip_type === "business" ? numOrNull(t.end_lat) : null,
    end_lng: trip_type === "business" ? numOrNull(t.end_lng) : null,
    deleted: t.deleted === true,
  };
  for (const [k, x] of Object.entries(v)) if (Number.isNaN(x)) return { error: `Bad ${k}.` };
  if (!v.deleted) {
    // ATO logbook: every journey needs start and end odometer readings.
    if (v.start_odo == null || v.end_odo == null) return { error: "Start and end odometer readings are required." };
    if (v.end_odo <= v.start_odo) return { error: "End odometer must be higher than start." };
    if (!v.vehicle_id) return { error: "Choose which car the trip was in." };
    if (trip_type === "business" && !v.job_no && !v.purpose) return { error: "Business trips need a job number or reason." };
  }
  if (v.start_odo != null && v.end_odo != null && v.end_odo > v.start_odo) v.km = Math.round((v.end_odo - v.start_odo) * 10) / 10;
  if (v.km == null || v.km < 0 || v.km >= 3000) return { error: "Km must be between 0 and 3,000." };
  return { value: v };
}

const COLS = ["id","user_id","vehicle_id","trip_date","end_date","trip_type","started_at","ended_at","km","start_odo","end_odo","source","gps_km",
  "from_text","to_text","job_no","purpose","start_lat","start_lng","end_lat","end_lng","deleted"];
// On re-upload, everything is editable except who owns it, the GPS figure, and when it was first saved.
const UPDATABLE = COLS.filter((c) => !["id", "user_id", "gps_km"].includes(c));
const UPSERT = `
  insert into trips (${COLS.join(",")}) values (${COLS.map((_, i) => `$${i + 1}`).join(",")})
  on conflict (id) do update set ${UPDATABLE.map((c) => `${c} = excluded.${c}`).join(", ")}, updated_at = now()
  where trips.user_id = $2
  returning id`;

// POST /api/trips/sync  { trips: [...] }  -> { saved: [id], rejected: [{id, error}] }
router.post("/sync", async (req, res) => {
  const list = Array.isArray(req.body?.trips) ? req.body.trips.slice(0, 200) : [];
  const saved = [], rejected = [];
  for (const raw of list) {
    const { value, error } = cleanTrip(raw);
    if (error) { rejected.push({ id: raw?.id ?? null, error }); continue; }
    if (value.vehicle_id) {
      // Must be the tech's own car (or a company car)
      const { rowCount } = await query("select 1 from vehicles where id = $1 and (owner_id = $2 or owner_id is null)", [value.vehicle_id, req.user.id]);
      if (!rowCount) { rejected.push({ id: value.id, error: "That car isn't one of yours." }); continue; }
    }
    const row = { ...value, user_id: req.user.id };
    try {
      const { rowCount } = await query(UPSERT, COLS.map((c) => row[c]));
      if (rowCount) saved.push(value.id);
      else rejected.push({ id: value.id, error: "That trip belongs to someone else." });
    } catch (e) {
      console.error("trip upsert failed", e.message);
      rejected.push({ id: value.id, error: "Server couldn't save this trip." });
    }
  }
  res.json({ saved, rejected });
});

// GET /api/trips?since=YYYY-MM-DD  -> your own trips
router.get("/", async (req, res) => {
  const since = ISO.test(String(req.query.since)) ? req.query.since : "1900-01-01";
  const { rows } = await query(
    "select * from trips where user_id = $1 and trip_date >= $2 order by trip_date desc, started_at desc nulls last limit 5000",
    [req.user.id, since]
  );
  res.json({ trips: rows });
});

export default router;
