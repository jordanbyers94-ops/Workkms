const z = (n: number) => String(n).padStart(2, "0");

export const todayISO = (d = new Date()) => `${d.getFullYear()}-${z(d.getMonth() + 1)}-${z(d.getDate())}`;

export const parseISO = (iso: string) => {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(y, m - 1, d);
};

/** Australian financial year starting year: July 2026 to June 2027 -> 2026 */
export const fyOf = (iso: string) => {
  const [y, m] = iso.split("-").map(Number);
  return m >= 7 ? y : y - 1;
};
export const fyLabel = (y: number) => `FY ${y}–${String(y + 1).slice(2)}`;
export const fyStartISO = (y: number) => `${y}-07-01`;

export const weekStartISO = (d = new Date()) => {
  const c = new Date(d);
  c.setDate(c.getDate() - ((c.getDay() + 6) % 7));
  return todayISO(c);
};

export const isValidISO = (s: string) =>
  /^\d{4}-\d{2}-\d{2}$/.test(s) && todayISO(parseISO(s)) === s;

export const fmtKm = (n: number) => n.toLocaleString("en-AU", { minimumFractionDigits: 1, maximumFractionDigits: 1 });
export const round1 = (n: number) => Math.round(n * 10) / 10;

export const duration = (ms: number) => {
  const m = Math.max(0, Math.floor(ms / 60000));
  return m < 60 ? `${m} min` : `${Math.floor(m / 60)} h ${m % 60} min`;
};
