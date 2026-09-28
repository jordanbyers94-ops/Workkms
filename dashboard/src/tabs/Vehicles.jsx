import React, { useState } from "react";
import { api } from "../api.js";

export default function Vehicles({ vehicles, staff = [], reload }) {
  const owner = (id) => (id ? staff.find((x) => x.id === id)?.full_name ?? "Unknown" : "Company");
  const [name, setName] = useState("");
  const [rego, setRego] = useState("");
  const [status, setStatus] = useState({ text: "", err: false });

  const add = async (e) => {
    e.preventDefault();
    try {
      await api("/admin/vehicles", { method: "POST", body: { name, rego } });
      setStatus({ text: `Added ${name.trim()}.`, err: false });
      setName(""); setRego("");
      await reload();
    } catch (x) { setStatus({ text: x.message, err: true }); }
  };
  const toggle = async (v) => {
    try { await api(`/admin/vehicles/${v.id}`, { method: "PATCH", body: { active: !v.active } }); await reload(); }
    catch (x) { setStatus({ text: x.message, err: true }); }
  };

  return (
    <div className="panel">
      <h2>Vehicles</h2>
      <p className="note">Techs add their own cars in the app or under My logbook. Company vehicles can be added below.</p>
      <div className="scroll">
        {vehicles.length ? (
          <table>
            <thead><tr><th>Car</th><th>Owner</th><th>Make / model</th><th>Engine</th><th>Rego</th><th>Status</th><th /></tr></thead>
            <tbody>
              {vehicles.map((v) => (
                <tr key={v.id}>
                  <td>{v.name}</td><td>{owner(v.owner_id)}</td><td>{[v.make, v.model].filter(Boolean).join(" ")}</td><td>{v.engine}</td><td>{v.rego}</td>
                  <td>{v.active ? "In use" : <span className="tag">Retired</span>}</td>
                  <td className="actions">{!v.owner_id && <button className="btn ghost small" onClick={() => toggle(v)}>{v.active ? "Retire" : "Bring back"}</button>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : <p className="empty">No vehicles yet. Techs add their own cars when they first log a trip.</p>}
      </div>
      <form className="form-row" onSubmit={add}>
        <label className="f">Name<input value={name} onChange={(e) => setName(e.target.value)} required placeholder="e.g. Hilux 3" /></label>
        <label className="f">Rego<input value={rego} onChange={(e) => setRego(e.target.value)} placeholder="e.g. 123ABC" /></label>
        <button className="btn">Add company vehicle</button>
      </form>
      <p className={`msg pad${status.err ? " err" : ""}`}>{status.text}</p>
    </div>
  );
}
