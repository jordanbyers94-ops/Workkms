import React, { useCallback, useEffect, useMemo, useState } from "react";
import { api } from "../api.js";
import { downloadCSV, fmtDate, fyLabel, fyOf, isEdited, km1, money, sourceLabel, todayISO } from "../lib.js";

export default function Trips({ staff, vehicles, settings, reloadShared }) {
  const curFy = fyOf(todayISO());
  const [fy, setFy] = useState(curFy);
  const [month, setMonth] = useState("");
  const [user, setUser] = useState("");
  const [search, setSearch] = useState("");
  const [showDeleted, setShowDeleted] = useState(false);
  const [trips, setTrips] = useState([]);
  const [status, setStatus] = useState({ text: "Loading trips…", err: false });

  const load = useCallback(async () => {
    setStatus({ text: "Loading trips…", err: false });
    try {
      const { trips } = await api(`/admin/trips?from=${fy}-07-01&to=${fy + 1}-06-30`);
      setTrips(trips);
      setStatus({ text: "", err: false });
    } catch (e) {
      setStatus({ text: e.message, err: true });
    }
  }, [fy]);
  useEffect(() => { load(); }, [load]);

  const staffById = useMemo(() => new Map(staff.map((s) => [s.id, s])), [staff]);
  const name = (id) => staffById.get(id)?.full_name ?? "Unknown";
  const vehName = (id) => { const v = vehicles.find((x) => x.id === id); return v ? v.name + (v.rego ? ` (${v.rego})` : "") : ""; };

  const months = useMemo(() => Array.from({ length: 12 }, (_, i) => {
    const d = new Date(fy, 6 + i, 1);
    return { value: `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`, label: d.toLocaleDateString("en-AU", { month: "long", year: "numeric" }) };
  }), [fy]);

  const list = useMemo(() => {
    const q = search.trim().toLowerCase();
    return trips.filter((t) =>
      (showDeleted || !t.deleted) &&
      (!month || t.trip_date.startsWith(month)) &&
      (!user || t.user_id === user) &&
      (!q || [t.job_no, t.purpose, t.from_text, t.to_text, name(t.user_id)].some((v) => String(v ?? "").toLowerCase().includes(q)))
    );
  }, [trips, month, user, search, showDeleted, staffById]);

  const live = list.filter((t) => !t.deleted);
  const rate = Number(settings.rate_per_km) || 0;
  const total = live.reduce((s, t) => s + t.km, 0);
  const gpsShare = live.length ? Math.round((100 * live.filter((t) => t.source === "gps").length) / live.length) : 0;

  const byPerson = useMemo(() => {
    const m = new Map();
    for (const t of live) {
      const r = m.get(t.user_id) ?? { trips: 0, km: 0, gps: 0, edited: 0 };
      r.trips++; r.km += t.km; if (t.source === "gps") r.gps++; if (isEdited(t)) r.edited++;
      m.set(t.user_id, r);
    }
    return [...m.entries()].sort((a, b) => b[1].km - a[1].km);
  }, [live]);

  const exportCsv = () => {
    const rows = [["Date", "Staff", "Staff code", "Job", "Purpose", "From", "To", "Vehicle", "Recorded by", "Start odometer", "End odometer", "GPS km", "Km", "Edited", "Deleted"]];
    for (const t of [...list].reverse()) {
      const p = staffById.get(t.user_id) ?? {};
      rows.push([t.trip_date, p.full_name, p.staff_code, t.job_no, t.purpose, t.from_text, t.to_text, vehName(t.vehicle_id),
        sourceLabel(t.source), t.start_odo, t.end_odo, t.gps_km, t.km, isEdited(t) ? "Yes" : "", t.deleted ? "Yes" : ""]);
    }
    downloadCSV(`work-kms-${month || `FY${fy}-${String(fy + 1).slice(2)}`}.csv`, rows);
  };

  return (
    <section>
      <div className="toolbar">
        <label className="f">Financial year
          <select value={fy} onChange={(e) => { setFy(Number(e.target.value)); setMonth(""); }}>
            {[0, 1, 2, 3].map((i) => <option key={i} value={curFy - i}>{fyLabel(curFy - i)}</option>)}
          </select>
        </label>
        <label className="f">Month
          <select value={month} onChange={(e) => setMonth(e.target.value)}>
            <option value="">Whole year</option>
            {months.map((m) => <option key={m.value} value={m.value}>{m.label}</option>)}
          </select>
        </label>
        <label className="f">Staff member
          <select value={user} onChange={(e) => setUser(e.target.value)}>
            <option value="">Everyone</option>
            {staff.map((s) => <option key={s.id} value={s.id}>{s.full_name}{s.active ? "" : " (inactive)"}</option>)}
          </select>
        </label>
        <label className="f">Search<input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Job, purpose, place" /></label>
        <label className="check"><input type="checkbox" checked={showDeleted} onChange={(e) => setShowDeleted(e.target.checked)} /> Show deleted</label>
        <button className="btn ghost" onClick={() => { reloadShared(); load(); }}>Refresh</button>
        <button className="btn dark" onClick={exportCsv} disabled={!list.length}>Export CSV</button>
      </div>
      <p className={`msg${status.err ? " err" : ""}`}>{status.text}</p>

      <div className="panel">
        <div className="big">
          <div><b>{km1(total)} km</b><small>Total</small></div>
          <div><b>{live.length}</b><small>Trips</small></div>
          <div><b>{money(total * rate)}</b><small>At {money(rate)}/km</small></div>
          <div><b>{gpsShare}%</b><small>Tracked by GPS</small></div>
        </div>
      </div>

      <div className="panel">
        <h2>By staff member</h2>
        <div className="scroll">
          {byPerson.length ? (
            <table>
              <thead><tr><th>Name</th><th className="num">Trips</th><th className="num">Km</th><th className="num">By GPS</th><th className="num">Edited</th><th className="num">Amount</th></tr></thead>
              <tbody>
                {byPerson.map(([id, r]) => (
                  <tr key={id}><td>{name(id)}</td><td className="num">{r.trips}</td><td className="num">{km1(r.km)}</td>
                    <td className="num">{r.gps}</td><td className="num">{r.edited || ""}</td><td className="num">{money(r.km * rate)}</td></tr>
                ))}
              </tbody>
              <tfoot><tr><td>Total</td><td className="num">{live.length}</td><td className="num">{km1(total)}</td><td /><td /><td className="num">{money(total * rate)}</td></tr></tfoot>
            </table>
          ) : <p className="empty">No trips match these filters.</p>}
        </div>
      </div>

      <div className="panel">
        <h2>Trips</h2>
        <p className="note">"Edited" means the km differs from what GPS measured by more than 5%, or the trip was changed after it was first uploaded.</p>
        <div className="scroll">
          {list.length ? (
            <table>
              <thead><tr><th>Date</th><th>Staff</th><th>Job</th><th>Purpose</th><th>From</th><th>To</th><th>Vehicle</th><th>Recorded</th><th className="num">GPS km</th><th className="num">Km</th></tr></thead>
              <tbody>
                {list.map((t) => (
                  <tr key={t.id} className={t.deleted ? "deleted" : undefined}>
                    <td>{fmtDate(t.trip_date)}</td><td>{name(t.user_id)}</td><td>{t.job_no}</td><td className="wide">{t.purpose}</td>
                    <td>{t.from_text}</td><td>{t.to_text}</td><td>{vehName(t.vehicle_id)}</td>
                    <td>
                      <span className="tag">{sourceLabel(t.source)}</span>
                      {isEdited(t) && <span className="tag warn">Edited</span>}
                      {t.deleted && <span className="tag">Deleted</span>}
                    </td>
                    <td className="num">{t.gps_km != null ? km1(t.gps_km) : ""}</td><td className="num">{km1(t.km)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : <p className="empty">No trips match these filters.</p>}
        </div>
      </div>
    </section>
  );
}
