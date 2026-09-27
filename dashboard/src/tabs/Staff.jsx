import React, { useState } from "react";
import { api } from "../api.js";

export default function Staff({ me, staff, reload }) {
  const [form, setForm] = useState({ full_name: "", staff_code: "", role: "tech", secret: "" });
  const [status, setStatus] = useState({ text: "", err: false });
  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value });
  const isAdmin = form.role === "admin";

  const run = async (fn) => {
    try { setStatus({ text: await fn(), err: false }); await reload(); }
    catch (e) { setStatus({ text: e.message, err: true }); }
  };

  const add = (e) => {
    e.preventDefault();
    run(async () => {
      await api("/admin/staff", { method: "POST", body: form });
      const code = form.staff_code.trim().toLowerCase();
      setForm({ full_name: "", staff_code: "", role: "tech", secret: "" });
      return `Added ${form.full_name}. They sign in with staff code "${code}".`;
    });
  };
  const reset = (s) => {
    const label = s.role === "admin" ? "password" : "PIN";
    const secret = prompt(s.role === "admin" ? `New password for ${s.full_name} (at least 10 characters)` : `New 6-digit PIN for ${s.full_name}`);
    if (!secret) return;
    run(async () => { await api(`/admin/staff/${s.id}/reset`, { method: "POST", body: { secret } }); return `${label[0].toUpperCase() + label.slice(1)} updated for ${s.full_name}. They'll need to sign in again.`; });
  };
  const toggle = (s) => {
    if (s.active && !confirm(`Deactivate ${s.full_name}? They'll be signed out and can't sign in again. Their trips stay on record.`)) return;
    run(async () => { await api(`/admin/staff/${s.id}/active`, { method: "POST", body: { active: !s.active } }); return `${s.full_name} ${s.active ? "deactivated" : "reactivated"}.`; });
  };

  return (
    <div className="panel">
      <h2>Staff</h2>
      <div className="scroll">
        <table>
          <thead><tr><th>Name</th><th>Staff code</th><th>Role</th><th>Status</th><th /></tr></thead>
          <tbody>
            {staff.map((s) => (
              <tr key={s.id}>
                <td>{s.full_name}</td><td>{s.staff_code}</td><td>{s.role === "admin" ? "Office admin" : "Technician"}</td>
                <td>{s.active ? "Active" : <span className="tag">Inactive</span>}</td>
                <td className="actions">
                  <button className="btn ghost small" onClick={() => reset(s)}>Reset {s.role === "admin" ? "password" : "PIN"}</button>
                  {s.id !== me.id && <button className="btn ghost small" onClick={() => toggle(s)}>{s.active ? "Deactivate" : "Reactivate"}</button>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <form className="form-row" onSubmit={add}>
        <label className="f">Full name<input value={form.full_name} onChange={set("full_name")} required /></label>
        <label className="f">Staff code<input value={form.staff_code} onChange={set("staff_code")} required autoCapitalize="none" placeholder="e.g. jsmith" /></label>
        <label className="f">Role
          <select value={form.role} onChange={set("role")}>
            <option value="tech">Technician (6-digit PIN)</option>
            <option value="admin">Office admin (password)</option>
          </select>
        </label>
        <label className="f">{isAdmin ? "Password" : "PIN"}
          <input value={form.secret} onChange={set("secret")} required type={isAdmin ? "password" : "text"} inputMode={isAdmin ? "text" : "numeric"} autoComplete="new-password" />
        </label>
        <button className="btn">Add staff member</button>
      </form>
      <p className={`msg pad${status.err ? " err" : ""}`}>{status.text}</p>
    </div>
  );
}
