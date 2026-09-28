import React, { useCallback, useEffect, useState } from "react";
import { api } from "../api.js";
import { downloadCSV, fyLabel, fyOf, km1, todayISO } from "../lib.js";

const blankCar = { name: "", make: "", model: "", engine: "", rego: "", is_car: true };
const longDate = (iso) => (iso ? new Date(iso + "T00:00").toLocaleDateString("en-AU", { day: "numeric", month: "short", year: "numeric" }) : "");
const carLabel = (v) => (v ? `${v.name}${v.rego ? ` (${v.rego})` : ""}` : "");

export default function MyLogbook({ me }) {
  const [cars, setCars] = useState([]);
  const [logbooks, setLogbooks] = useState([]);
  const [readings, setReadings] = useState([]);
  const [report, setReport] = useState(null);
  const [status, setStatus] = useState({ text: "", err: false });

  const load = useCallback(async () => {
    const [c, l, r] = await Promise.all([api("/my/vehicles"), api("/my/logbooks"), api("/my/readings")]);
    setCars(c.vehicles.filter((v) => v.owner_id === me.id));
    setLogbooks(l.logbooks);
    setReadings(r.readings);
  }, [me.id]);
  useEffect(() => { load().catch((e) => setStatus({ text: e.message, err: true })); }, [load]);

  const run = async (fn) => {
    try { const text = await fn(); setStatus({ text: text || "", err: false }); await load(); return true; }
    catch (e) { setStatus({ text: e.message, err: true }); return false; }
  };

  const openReport = async (id) => {
    try { const { report } = await api(`/my/logbooks/${id}/report`); setReport(report); window.scrollTo(0, 0); }
    catch (e) { setStatus({ text: e.message, err: true }); }
  };

  if (report) return <Report report={report} me={me} onBack={() => setReport(null)} />;

  return (
    <section>
      <p className={`msg${status.err ? " err" : ""}`}>{status.text}</p>
      <Intro />
      <Cars cars={cars} run={run} />
      <Periods cars={cars} logbooks={logbooks} run={run} openReport={openReport} />
      <Readings cars={cars} readings={readings} run={run} />
      <YearRecord cars={cars} />
    </section>
  );
}

function Intro() {
  return (
    <div className="panel">
      <h2>Your car logbook</h2>
      <p className="note" style={{ marginBottom: 14 }}>
        This is your own record for claiming your car on tax. The office only sees your business trips. Private trips, logbook
        periods and odometer readings are yours alone. To use the ATO logbook method, run a logbook period for at least 12 continuous
        weeks. Log every trip in that time, business and private, each with start and end odometer readings. A logbook stays valid for
        five years if your driving doesn't change much, as long as you record the odometer each 30 June. Keep your records for five
        years after you lodge. Ask your accountant which claim method suits you.
      </p>
    </div>
  );
}

function Cars({ cars, run }) {
  const [form, setForm] = useState(blankCar);
  const [editing, setEditing] = useState(null);
  const set = (k) => (e) => setForm({ ...form, [k]: e.target.type === "checkbox" ? !e.target.checked : e.target.value });

  const save = async (e) => {
    e.preventDefault();
    const ok = await run(async () => {
      if (editing) { await api(`/my/vehicles/${editing}`, { method: "PATCH", body: form }); return "Car updated."; }
      await api("/my/vehicles", { method: "POST", body: form }); return "Car added.";
    });
    if (ok) { setForm(blankCar); setEditing(null); }
  };

  return (
    <div className="panel">
      <h2>My cars</h2>
      <div className="scroll">
        {cars.length ? (
          <table>
            <thead><tr><th>Car</th><th>Make / model</th><th>Engine</th><th>Rego</th><th className="num">Last odometer</th><th /></tr></thead>
            <tbody>
              {cars.map((v) => (
                <tr key={v.id}>
                  <td>{v.name}{!v.is_car && <span className="tag" style={{ marginLeft: 6 }}>Not a "car"</span>}</td>
                  <td>{v.make} {v.model}</td><td>{v.engine}</td><td>{v.rego}</td>
                  <td className="num">{v.last_odo != null ? km1(v.last_odo) : ""}</td>
                  <td className="actions"><button className="btn ghost small" onClick={() => { setEditing(v.id); setForm({ name: v.name, make: v.make ?? "", model: v.model ?? "", engine: v.engine ?? "", rego: v.rego ?? "", is_car: v.is_car }); }}>Edit</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : <p className="empty">No cars yet. Add the car you drive for work. The ATO needs its make, model, engine capacity and rego.</p>}
      </div>
      <form className="form-row" onSubmit={save}>
        <label className="f">Make<input value={form.make} onChange={set("make")} required placeholder="Toyota" /></label>
        <label className="f">Model<input value={form.model} onChange={set("model")} required placeholder="Hilux SR5" /></label>
        <label className="f">Engine capacity<input value={form.engine} onChange={set("engine")} required placeholder="2.8L" /></label>
        <label className="f">Rego<input value={form.rego} onChange={set("rego")} required placeholder="123ABC" /></label>
        <label className="f">Nickname (optional)<input value={form.name} onChange={set("name")} placeholder="Work ute" /></label>
        <label className="check"><input type="checkbox" checked={!form.is_car} onChange={set("is_car")} /> Carries 1 tonne+ or 9+ people</label>
        <button className="btn">{editing ? "Save car" : "Add car"}</button>
        {editing && <button type="button" className="btn ghost" onClick={() => { setEditing(null); setForm(blankCar); }}>Cancel</button>}
      </form>
    </div>
  );
}

function Periods({ cars, logbooks, run, openReport }) {
  const [form, setForm] = useState({ vehicle_id: "", start_date: todayISO(), start_odo: "" });
  const [closing, setClosing] = useState(null);
  const [close, setClose] = useState({ end_date: todayISO(), end_odo: "" });

  useEffect(() => {
    if (!form.vehicle_id && cars[0]) setForm((f) => ({ ...f, vehicle_id: cars[0].id, start_odo: cars[0].last_odo ?? "" }));
  }, [cars, form.vehicle_id]);

  const start = (e) => {
    e.preventDefault();
    run(async () => { await api("/my/logbooks", { method: "POST", body: { ...form, start_odo: Number(form.start_odo) } }); return "Logbook period started. Log every trip in this car until it ends, private ones included."; });
  };
  const finish = (id) => async (e) => {
    e.preventDefault();
    const ok = await run(async () => { await api(`/my/logbooks/${id}`, { method: "PATCH", body: { ...close, end_odo: Number(close.end_odo) } }); return "Logbook period finished."; });
    if (ok) setClosing(null);
  };
  const days = (l) => Math.round((new Date(l.end_date ?? todayISO()) - new Date(l.start_date)) / 86400000) + 1;

  return (
    <div className="panel">
      <h2>Logbook periods</h2>
      <div className="scroll">
        {logbooks.length ? (
          <table>
            <thead><tr><th>Car</th><th>Started</th><th className="num">Opening odometer</th><th>Finished</th><th className="num">Closing odometer</th><th>Length</th><th /></tr></thead>
            <tbody>
              {logbooks.map((l) => (
                <React.Fragment key={l.id}>
                  <tr>
                    <td>{l.vehicle_name} {l.vehicle_rego && `(${l.vehicle_rego})`}</td>
                    <td>{longDate(l.start_date)}</td><td className="num">{km1(l.start_odo)}</td>
                    <td>{l.end_date ? longDate(l.end_date) : <span className="tag warn">Running</span>}</td>
                    <td className="num">{l.end_odo != null ? km1(l.end_odo) : ""}</td>
                    <td>{Math.floor(days(l) / 7)} wk {days(l) % 7} d{days(l) < 84 ? <span className="tag" style={{ marginLeft: 6 }}>under 12 wk</span> : null}</td>
                    <td className="actions">
                      <button className="btn ghost small" onClick={() => openReport(l.id)}>Report</button>
                      {!l.end_date && <button className="btn ghost small" onClick={() => { setClosing(l.id); setClose({ end_date: todayISO(), end_odo: "" }); }}>Finish</button>}
                    </td>
                  </tr>
                  {closing === l.id && (
                    <tr><td colSpan={7}>
                      <form className="toolbar" style={{ margin: 0 }} onSubmit={finish(l.id)}>
                        <label className="f">End date<input type="date" value={close.end_date} onChange={(e) => setClose({ ...close, end_date: e.target.value })} required /></label>
                        <label className="f">Closing odometer<input value={close.end_odo} onChange={(e) => setClose({ ...close, end_odo: e.target.value })} inputMode="decimal" required /></label>
                        <button className="btn">Finish period</button>
                        <button type="button" className="btn ghost" onClick={() => setClosing(null)}>Cancel</button>
                      </form>
                    </td></tr>
                  )}
                </React.Fragment>
              ))}
            </tbody>
          </table>
        ) : <p className="empty">No logbook periods yet.</p>}
      </div>
      {cars.length ? (
        <form className="form-row" onSubmit={start}>
          <label className="f">Car
            <select value={form.vehicle_id} onChange={(e) => { const c = cars.find((x) => x.id === e.target.value); setForm({ ...form, vehicle_id: e.target.value, start_odo: c?.last_odo ?? "" }); }}>
              {cars.map((c) => <option key={c.id} value={c.id}>{carLabel(c)}</option>)}
            </select>
          </label>
          <label className="f">Start date<input type="date" value={form.start_date} onChange={(e) => setForm({ ...form, start_date: e.target.value })} required /></label>
          <label className="f">Opening odometer<input value={form.start_odo} onChange={(e) => setForm({ ...form, start_odo: e.target.value })} inputMode="decimal" required /></label>
          <button className="btn">Start a logbook period</button>
        </form>
      ) : null}
      <p className="note pad">Pick 12 weeks that are typical of your driving, not an unusually busy or quiet stretch. If you run logbooks for two cars, they must cover the same dates.</p>
    </div>
  );
}

function Readings({ cars, readings, run }) {
  const fy = fyOf(todayISO());
  const [form, setForm] = useState({ vehicle_id: "", reading_date: `${fy}-06-30` > todayISO() ? `${fy}-06-30` : todayISO(), odo: "", note: "30 June reading" });
  useEffect(() => { if (!form.vehicle_id && cars[0]) setForm((f) => ({ ...f, vehicle_id: cars[0].id })); }, [cars, form.vehicle_id]);
  const add = (e) => {
    e.preventDefault();
    run(async () => { await api("/my/readings", { method: "POST", body: { ...form, odo: Number(form.odo) } }); setForm((f) => ({ ...f, odo: "" })); return "Reading saved."; });
  };
  const carName = (id) => carLabel(cars.find((c) => c.id === id));

  return (
    <div className="panel">
      <h2>Odometer readings</h2>
      <p className="note">Record each car's odometer on 30 June every year you rely on a logbook, plus any other readings you want on file.</p>
      <div className="scroll">
        {readings.length ? (
          <table>
            <thead><tr><th>Date</th><th>Car</th><th className="num">Odometer</th><th>Note</th></tr></thead>
            <tbody>{readings.map((r) => <tr key={r.id}><td>{longDate(r.reading_date)}</td><td>{carName(r.vehicle_id)}</td><td className="num">{km1(r.odo)}</td><td>{r.note}</td></tr>)}</tbody>
          </table>
        ) : <p className="empty">No readings yet.</p>}
      </div>
      {cars.length ? (
        <form className="form-row" onSubmit={add}>
          <label className="f">Car<select value={form.vehicle_id} onChange={(e) => setForm({ ...form, vehicle_id: e.target.value })}>{cars.map((c) => <option key={c.id} value={c.id}>{carLabel(c)}</option>)}</select></label>
          <label className="f">Date<input type="date" value={form.reading_date} max={todayISO()} onChange={(e) => setForm({ ...form, reading_date: e.target.value })} required /></label>
          <label className="f">Odometer<input value={form.odo} onChange={(e) => setForm({ ...form, odo: e.target.value })} inputMode="decimal" required /></label>
          <label className="f">Note<input value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })} /></label>
          <button className="btn">Save reading</button>
        </form>
      ) : null}
    </div>
  );
}

function YearRecord({ cars }) {
  const cur = fyOf(todayISO());
  const [fy, setFy] = useState(cur);
  const [trips, setTrips] = useState(null);
  const [err, setErr] = useState("");
  useEffect(() => {
    setTrips(null);
    api(`/my/trips?from=${fy}-07-01&to=${fy + 1}-06-30`).then((r) => setTrips(r.trips)).catch((e) => setErr(e.message));
  }, [fy]);
  const car = (id) => cars.find((c) => c.id === id);
  const perCar = new Map();
  for (const t of trips ?? []) {
    const k = t.vehicle_id ?? "none";
    const r = perCar.get(k) ?? { business: 0, private: 0 };
    r[t.trip_type === "private" ? "private" : "business"] += t.km;
    perCar.set(k, r);
  }
  const exportCsv = () => {
    const rows = [["Start date", "End date", "Car", "Rego", "Type", "Reason", "Job", "From", "To", "Start odometer", "End odometer", "Km", "Recorded by", "GPS km"]];
    for (const t of trips) {
      const c = car(t.vehicle_id) ?? {};
      rows.push([t.trip_date, t.end_date ?? t.trip_date, c.name, c.rego, t.trip_type === "private" ? "Private" : "Business", t.trip_type === "private" ? "Private" : t.purpose,
        t.job_no, t.from_text, t.to_text, t.start_odo, t.end_odo, t.km, t.source === "gps" ? "GPS + odometer" : "Odometer", t.gps_km]);
    }
    downloadCSV(`my-car-trips-FY${fy}-${String(fy + 1).slice(2)}.csv`, rows);
  };

  return (
    <div className="panel">
      <h2>Year summary</h2>
      <div className="toolbar" style={{ padding: "12px 16px 0" }}>
        <label className="f">Financial year
          <select value={fy} onChange={(e) => setFy(Number(e.target.value))}>{[0, 1, 2, 3, 4].map((i) => <option key={i} value={cur - i}>{fyLabel(cur - i)}</option>)}</select>
        </label>
        <button className="btn dark" onClick={exportCsv} disabled={!trips?.length}>Download all trips (CSV)</button>
      </div>
      {err && <p className="msg err pad">{err}</p>}
      <div className="scroll">
        {trips === null ? <p className="empty">Loading…</p> : perCar.size ? (
          <table>
            <thead><tr><th>Car</th><th className="num">Business km</th><th className="num">Private km logged</th></tr></thead>
            <tbody>{[...perCar].map(([id, r]) => <tr key={id}><td>{carLabel(car(id)) || "No car recorded"}</td><td className="num">{km1(r.business)}</td><td className="num">{km1(r.private)}</td></tr>)}</tbody>
          </table>
        ) : <p className="empty">No trips in {fyLabel(fy)}.</p>}
      </div>
      <p className="note pad">If you use the cents-per-km method, you can claim up to 5,000 business km per car at the ATO rate for that year, and this record shows how you worked out your kms. Any per-km payments from work are shown on your income statement.</p>
    </div>
  );
}

function Report({ report, me, onBack }) {
  const { logbook: l, vehicle: v, totals: t, trips, gaps, readings, warnings, vague_ids } = report;
  const vague = new Set(vague_ids);
  // Interleave unlogged gaps into the journey list, in odometer order
  const rows = [];
  const gapQueue = [...gaps];
  for (const trip of trips) {
    while (gapQueue.length && trip.start_odo != null && gapQueue[0].to_odo <= trip.start_odo) rows.push({ gap: gapQueue.shift() });
    rows.push({ trip });
  }
  gapQueue.forEach((g) => rows.push({ gap: g }));

  return (
    <section className="report">
      <div className="toolbar no-print">
        <button className="btn ghost" onClick={onBack}>← Back</button>
        <button className="btn" onClick={() => window.print()}>Print or save as PDF</button>
      </div>
      {warnings.length > 0 && (
        <div className="panel no-print warn-box">
          <h2>Check before relying on this logbook</h2>
          <ul>{warnings.map((w, i) => <li key={i}>{w}</li>)}</ul>
        </div>
      )}
      <div className="panel sheet">
        <h2 style={{ fontSize: 26 }}>Motor vehicle logbook</h2>
        <p className="muted" style={{ margin: "2px 16px 0" }}>{me.full_name}</p>
        <div className="facts">
          <div><small>Vehicle</small><b>{v.make} {v.model}</b></div>
          <div><small>Engine capacity</small><b>{v.engine}</b></div>
          <div><small>Registration</small><b>{v.rego}</b></div>
          <div><small>Logbook period</small><b>{longDate(l.start_date)} to {l.end_date ? longDate(l.end_date) : "(still running)"}</b></div>
          <div><small>Length</small><b>{Math.floor(t.days / 7)} weeks {t.days % 7} days</b></div>
          <div><small>Odometer at start</small><b>{km1(l.start_odo)}</b></div>
          <div><small>Odometer at end</small><b>{l.end_odo != null ? km1(l.end_odo) : `${km1(t.closing_odo)} (latest)`}</b></div>
          <div><small>Total km travelled</small><b>{km1(t.total_km)}</b></div>
          <div><small>Business km</small><b>{km1(t.business_km)}</b></div>
          <div><small>Business-use percentage</small><b>{t.business_pct != null ? `${t.business_pct}%` : "n/a"}</b></div>
        </div>
        <p className="note">Business-use % = business km ÷ total km for the period. Private trips ({km1(t.private_km)} km) and any unlogged km ({km1(t.unlogged_km)} km) count as non-business.</p>

        <div className="scroll">
          <table>
            <thead><tr><th>Start date</th><th>End date</th><th className="num">Odometer start</th><th className="num">Odometer end</th><th className="num">Km</th><th>Type</th><th>Reason for journey</th></tr></thead>
            <tbody>
              {rows.map((r, i) => r.gap ? (
                <tr key={`g${i}`} className="gap-row"><td colSpan={2}>Not logged</td><td className="num">{km1(r.gap.from_odo)}</td><td className="num">{km1(r.gap.to_odo)}</td><td className="num">{km1(r.gap.km)}</td><td>Unlogged</td><td>Counted as non-business</td></tr>
              ) : (
                <tr key={r.trip.id}>
                  <td>{longDate(r.trip.trip_date)}</td><td>{longDate(r.trip.end_date ?? r.trip.trip_date)}</td>
                  <td className="num">{r.trip.start_odo != null ? km1(r.trip.start_odo) : "missing"}</td>
                  <td className="num">{r.trip.end_odo != null ? km1(r.trip.end_odo) : "missing"}</td>
                  <td className="num">{km1(r.trip.km)}</td>
                  <td>{r.trip.trip_type === "private" ? "Private" : "Business"}</td>
                  <td className="wide">{r.trip.trip_type === "private" ? "Private" : [r.trip.job_no && `Job ${r.trip.job_no}`, r.trip.purpose, r.trip.to_text && `to ${r.trip.to_text}`].filter(Boolean).join(", ")}
                    {vague.has(r.trip.id) && <span className="tag warn no-print" style={{ marginLeft: 6 }}>vague</span>}</td>
                </tr>
              ))}
            </tbody>
            <tfoot><tr><td colSpan={4}>Totals</td><td className="num">{km1(t.total_km)}</td><td colSpan={2}>Business {km1(t.business_km)}, private {km1(t.private_km)}, unlogged {km1(t.unlogged_km)}</td></tr></tfoot>
          </table>
        </div>

        <h3 style={{ margin: "18px 16px 6px" }}>Odometer readings in later years</h3>
        {readings.length ? (
          <table><thead><tr><th>Date</th><th className="num">Odometer</th><th>Note</th></tr></thead>
            <tbody>{readings.map((r) => <tr key={r.id}><td>{longDate(r.reading_date)}</td><td className="num">{km1(r.odo)}</td><td>{r.note}</td></tr>)}</tbody></table>
        ) : <p className="empty">None recorded yet. Add a reading each 30 June while you rely on this logbook.</p>}
        <p className="note pad">Generated {longDate(todayISO())} from Work kms. The time each entry was recorded is kept on file.</p>
      </div>
    </section>
  );
}
