import React, { useCallback, useEffect, useState } from "react";
import { api, getToken, setToken, setUnauthorizedHandler } from "./api.js";
import Settings from "./tabs/Settings.jsx";
import Staff from "./tabs/Staff.jsx";
import Trips from "./tabs/Trips.jsx";
import Vehicles from "./tabs/Vehicles.jsx";

const TABS = [["trips", "Trips"], ["staff", "Staff"], ["vehicles", "Vehicles"], ["settings", "Settings"]];

export default function App() {
  const [me, setMe] = useState(undefined);
  const [tab, setTab] = useState("trips");
  const [staff, setStaff] = useState([]);
  const [vehicles, setVehicles] = useState([]);
  const [settings, setSettings] = useState({ company_name: "Work kms", rate_per_km: 0.88 });

  const loadShared = useCallback(async () => {
    const [s, v, st] = await Promise.all([api("/admin/staff"), api("/admin/vehicles"), api("/settings")]);
    setStaff(s.staff); setVehicles(v.vehicles); setSettings(st.settings);
  }, []);

  useEffect(() => {
    setUnauthorizedHandler(() => setMe(null));
    if (!getToken()) return setMe(null);
    api("/me").then(({ profile }) => setMe(profile.role === "admin" ? profile : null)).catch(() => setMe(null));
  }, []);

  useEffect(() => { if (me) loadShared().catch(() => {}); }, [me, loadShared]);
  useEffect(() => { document.title = `Work kms office${settings.company_name ? `, ${settings.company_name}` : ""}`; }, [settings.company_name]);

  if (me === undefined) return null;
  if (!me) return <Login onSignedIn={setMe} />;

  return (
    <>
      <header>
        <div className="wrap">
          <div className="brand"><i /><h1>{settings.company_name || "Work kms"}</h1></div>
          <nav>
            {TABS.map(([k, label]) => (
              <button key={k} aria-current={tab === k ? "page" : undefined} onClick={() => setTab(k)}>{label}</button>
            ))}
          </nav>
          <div className="who">{me.full_name}<button onClick={() => { setToken(null); setMe(null); }}>Sign out</button></div>
        </div>
      </header>
      <main className="wrap">
        {tab === "trips" && <Trips staff={staff} vehicles={vehicles} settings={settings} reloadShared={loadShared} />}
        {tab === "staff" && <Staff me={me} staff={staff} reload={loadShared} />}
        {tab === "vehicles" && <Vehicles vehicles={vehicles} reload={loadShared} />}
        {tab === "settings" && <Settings settings={settings} onSaved={setSettings} />}
      </main>
    </>
  );
}

function Login({ onSignedIn }) {
  const [code, setCode] = useState("");
  const [pw, setPw] = useState("");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const submit = async (e) => {
    e.preventDefault();
    setErr("");
    if (!code.trim() || !pw) return setErr("Enter your staff code and password.");
    setBusy(true);
    try {
      const { token, profile } = await api("/auth/login", { method: "POST", body: { staff_code: code, secret: pw } });
      if (profile.role !== "admin") return setErr("This account isn't an office admin. Technicians use the phone app.");
      setToken(token);
      onSignedIn(profile);
    } catch (x) {
      setErr(x.message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <form className="login" onSubmit={submit}>
      <h1>Work kms</h1>
      <p className="muted" style={{ margin: 0 }}>Office dashboard. Sign in with an admin staff code and password.</p>
      <label className="f">Staff code<input value={code} onChange={(e) => setCode(e.target.value)} autoComplete="username" autoCapitalize="none" /></label>
      <label className="f">Password<input type="password" value={pw} onChange={(e) => setPw(e.target.value)} autoComplete="current-password" /></label>
      <p className="msg err">{err}</p>
      <button className="btn" disabled={busy}>{busy ? "Signing in…" : "Sign in"}</button>
    </form>
  );
}
