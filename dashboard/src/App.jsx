import React, { useCallback, useEffect, useState } from "react";
import { api, getToken, setToken, setUnauthorizedHandler } from "./api.js";
import MyLogbook from "./tabs/MyLogbook.jsx";
import Settings from "./tabs/Settings.jsx";
import Staff from "./tabs/Staff.jsx";
import Trips from "./tabs/Trips.jsx";
import Vehicles from "./tabs/Vehicles.jsx";

const ADMIN_TABS = [["trips", "Trips"], ["staff", "Staff"], ["vehicles", "Vehicles"], ["settings", "Settings"], ["mine", "My logbook"]];

export default function App() {
  const [me, setMe] = useState(undefined);
  const [tab, setTab] = useState(null);
  const [staff, setStaff] = useState([]);
  const [vehicles, setVehicles] = useState([]);
  const [settings, setSettings] = useState({ company_name: "Work kms", rate_per_km: 0.91, ato_rate: 0.91 });
  const isAdmin = me?.role === "admin";

  const loadShared = useCallback(async () => {
    const st = await api("/settings");
    setSettings(st.settings);
    if (!isAdmin) return;
    const [s, v] = await Promise.all([api("/admin/staff"), api("/admin/vehicles")]);
    setStaff(s.staff); setVehicles(v.vehicles);
  }, [isAdmin]);

  useEffect(() => {
    setUnauthorizedHandler(() => setMe(null));
    if (!getToken()) return setMe(null);
    api("/me").then(({ profile }) => setMe(profile)).catch(() => setMe(null));
  }, []);

  useEffect(() => { if (me) { setTab((t) => t ?? (isAdmin ? "trips" : "mine")); loadShared().catch(() => {}); } }, [me, isAdmin, loadShared]);
  useEffect(() => { document.title = `Work kms${settings.company_name ? `, ${settings.company_name}` : ""}`; }, [settings.company_name]);

  if (me === undefined) return null;
  if (!me) return <Login onSignedIn={(p) => { setTab(null); setMe(p); }} />;

  return (
    <>
      <header className="no-print">
        <div className="wrap">
          <div className="brand"><i /><h1>{settings.company_name || "Work kms"}</h1></div>
          <nav>
            {isAdmin && ADMIN_TABS.map(([k, label]) => (
              <button key={k} aria-current={tab === k ? "page" : undefined} onClick={() => setTab(k)}>{label}</button>
            ))}
            {!isAdmin && <button aria-current="page">My logbook</button>}
          </nav>
          <div className="who">{me.full_name}<button onClick={() => { setToken(null); setMe(null); }}>Sign out</button></div>
        </div>
      </header>
      <main className="wrap">
        {tab === "trips" && isAdmin && <Trips staff={staff} vehicles={vehicles} settings={settings} reloadShared={loadShared} />}
        {tab === "staff" && isAdmin && <Staff me={me} staff={staff} reload={loadShared} />}
        {tab === "vehicles" && isAdmin && <Vehicles vehicles={vehicles} staff={staff} reload={loadShared} />}
        {tab === "settings" && isAdmin && <Settings settings={settings} onSaved={setSettings} />}
        {tab === "mine" && <MyLogbook me={me} />}
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
    if (!code.trim() || !pw) return setErr("Enter your staff code and PIN or password.");
    setBusy(true);
    try {
      const { token, profile } = await api("/auth/login", { method: "POST", body: { staff_code: code, secret: pw } });
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
      <p className="muted" style={{ margin: 0 }}>Techs: sign in with your staff code and PIN to see your logbook. Office: use your admin password.</p>
      <label className="f">Staff code<input value={code} onChange={(e) => setCode(e.target.value)} autoComplete="username" autoCapitalize="none" /></label>
      <label className="f">PIN or password<input type="password" value={pw} onChange={(e) => setPw(e.target.value)} autoComplete="current-password" /></label>
      <p className="msg err">{err}</p>
      <button className="btn" disabled={busy}>{busy ? "Signing in…" : "Sign in"}</button>
    </form>
  );
}
