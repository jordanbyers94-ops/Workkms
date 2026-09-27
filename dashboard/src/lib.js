const z = (n) => String(n).padStart(2, "0");
export const todayISO = (d = new Date()) => `${d.getFullYear()}-${z(d.getMonth() + 1)}-${z(d.getDate())}`;
export const fyOf = (iso) => { const [y, m] = iso.split("-").map(Number); return m >= 7 ? y : y - 1; };
export const fyLabel = (y) => `FY ${y}–${String(y + 1).slice(2)}`;
export const km1 = (n) => Number(n || 0).toLocaleString("en-AU", { minimumFractionDigits: 1, maximumFractionDigits: 1 });
export const money = (n) => "$" + Number(n || 0).toLocaleString("en-AU", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
export const fmtDate = (iso) => new Date(iso + "T00:00").toLocaleDateString("en-AU", { weekday: "short", day: "numeric", month: "short" });
export const sourceLabel = (s) => (s === "gps" ? "GPS" : s === "odometer" ? "Odometer" : "Manual");

/** Km differs from GPS by more than 5%, or the trip was changed 5+ minutes after first upload */
export function isEdited(t) {
  const gpsDiff = t.gps_km != null && t.gps_km > 0 && Math.abs(t.km - t.gps_km) / t.gps_km > 0.05;
  const changed = t.updated_at && t.created_at && new Date(t.updated_at) - new Date(t.created_at) > 5 * 60 * 1000;
  return Boolean(gpsDiff || changed);
}

export function downloadCSV(filename, rows) {
  const q = (v) => { const s = String(v ?? ""); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
  const blob = new Blob([rows.map((r) => r.map(q).join(",")).join("\n")], { type: "text/csv" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}
