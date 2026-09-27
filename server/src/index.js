import express from "express";
import rateLimit from "express-rate-limit";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { login, publicProfile, requireAuth } from "./auth.js";
import { migrate, query } from "./db.js";
import adminRoutes from "./routes/admin.js";
import tripRoutes from "./routes/trips.js";

const app = express();
app.set("trust proxy", 1); // behind Railway + Cloudflare
app.disable("x-powered-by");
app.use(express.json({ limit: "1mb" }));
app.use((_req, res, next) => {
  res.set({ "X-Content-Type-Options": "nosniff", "Referrer-Policy": "same-origin", "X-Frame-Options": "DENY" });
  next();
});

// Wrap async handlers so a thrown error returns 500 instead of crashing
const wrap = (router) => {
  for (const layer of router.stack ?? []) {
    for (const l of layer.route?.stack ?? []) {
      const fn = l.handle;
      if (fn.length <= 3) l.handle = (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
    }
  }
  return router;
};

app.get("/api/health", async (_req, res) => {
  await query("select 1");
  res.json({ ok: true });
});

const loginLimiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: 30, standardHeaders: "draft-7", legacyHeaders: false,
  message: { error: "Too many sign-in attempts from this connection. Wait 15 minutes." } });

app.post("/api/auth/login", loginLimiter, async (req, res, next) => {
  try {
    const r = await login(req.body?.staff_code, req.body?.secret);
    if (r.status !== 200) return res.status(r.status).json({ error: r.error });
    res.json({ token: r.token, profile: r.profile });
  } catch (e) { next(e); }
});

app.use("/api", (req, res, next) => requireAuth(req, res, next).catch(next));

app.get("/api/me", (req, res) => res.json({ profile: publicProfile(req.user) }));
app.get("/api/vehicles", async (_req, res, next) => {
  try {
    const { rows } = await query("select id, name, rego from vehicles where active order by name");
    res.json({ vehicles: rows });
  } catch (e) { next(e); }
});
app.get("/api/settings", async (_req, res, next) => {
  try {
    const { rows } = await query("select company_name, rate_per_km from settings where id = 1");
    res.json({ settings: rows[0] });
  } catch (e) { next(e); }
});
app.use("/api/trips", wrap(tripRoutes));
app.use("/api/admin", wrap(adminRoutes));
app.use("/api", (_req, res) => res.status(404).json({ error: "Not found." }));

// Office dashboard (React/Vite build)
const dist = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../dashboard/dist");
if (existsSync(dist)) {
  app.use(express.static(dist, { index: false, maxAge: "1h" }));
  app.get("*", (_req, res) => res.sendFile(path.join(dist, "index.html")));
}

app.use((err, _req, res, _next) => {
  console.error(err);
  res.status(500).json({ error: "Something went wrong on the server." });
});

const port = Number(process.env.PORT) || 3000;
await migrate();
app.listen(port, () => console.log(`Work kms listening on ${port}`));
