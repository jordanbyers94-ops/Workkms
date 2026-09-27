import React, { useEffect, useState } from "react";
import { api } from "../api.js";

export default function Settings({ settings, onSaved }) {
  const [company, setCompany] = useState(settings.company_name ?? "");
  const [rate, setRate] = useState(Number(settings.rate_per_km).toFixed(2));
  const [status, setStatus] = useState({ text: "", err: false });
  useEffect(() => { setCompany(settings.company_name ?? ""); setRate(Number(settings.rate_per_km).toFixed(2)); }, [settings]);

  const save = async (e) => {
    e.preventDefault();
    try {
      const { settings: s } = await api("/admin/settings", { method: "PUT", body: { company_name: company, rate_per_km: Number(rate) } });
      onSaved(s);
      setStatus({ text: "Settings saved.", err: false });
    } catch (x) { setStatus({ text: x.message, err: true }); }
  };

  return (
    <div className="panel">
      <h2>Settings</h2>
      <form className="form-row" onSubmit={save} style={{ borderTop: "none" }}>
        <label className="f">Company name<input value={company} onChange={(e) => setCompany(e.target.value)} /></label>
        <label className="f">Reimbursement rate ($ per km)<input value={rate} onChange={(e) => setRate(e.target.value)} inputMode="decimal" /></label>
        <button className="btn">Save settings</button>
      </form>
      <p className={`msg pad${status.err ? " err" : ""}`}>{status.text}</p>
    </div>
  );
}
