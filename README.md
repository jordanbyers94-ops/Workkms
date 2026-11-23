# Work kms

A work kilometre logbook for technicians, with an office dashboard. It's built the same way as Core Covenant and Cornerstone Trades: React/Vite and Express on Railway, with the domain on Cloudflare.

```
Phones (Expo app) ──┐
                    ├──►  kms.yourdomain.com.au  (Cloudflare DNS)
Office browser  ────┘            │
                                 ▼
                    Railway service: Express
                      /api/*   JSON API
                      /*       React/Vite office dashboard
                                 │
                    Railway Postgres
```

- **Phone app** (`mobile/`): Expo / React Native for iPhone and Android.
  - Techs sign in with a staff code and 6-digit PIN, and stay signed in for 60 days, including offline.
  - **Start GPS trip** keeps measuring with the screen locked. They can also log a trip by odometer or distance.
  - Trips save on the phone first and upload when there's signal.
- **Server** (`server/`): Express + Postgres. It creates its own tables on start.
- **Dashboard** (`dashboard/`): React/Vite, built and served by the same Express service. It shows trips by financial year, month and person, with totals and amounts at your per-km rate. It also has CSV export and management for staff, vehicles and settings.

One Railway service plus one Postgres database. No other hosting.

## What the office can trust

The server enforces all of this, not just the app:

- A tech can only read and upload their own trips. The server ignores any user ID the phone sends and uses the signed-in account.
- The GPS-measured distance (`gps_km`) is locked after the first upload. If a tech changes the km, the dashboard shows both figures and flags the trip **Edited**. Changes made more than 5 minutes after the first upload are flagged too.
- There's no hard delete. A deleted trip disappears from the tech's list, and the office can still see it with **Show deleted**.
- PINs are stored as bcrypt hashes. Five wrong PINs locks the account for 15 minutes, and each connection is limited to 30 sign-in attempts per 15 minutes.
- Resetting a PIN or deactivating someone signs them out on every device straight away.

## ATO logbook (techs' own cars)

Techs drive their own cars, so each tech's logbook is their own tax record. The office sees business trips only.

**What the app records, per the ATO's logbook requirements:**
- **Every journey:** start and end date, start and end odometer, km, and the reason (business, with a job or reason, or private). Km is always worked out from the odometer readings. For GPS trips, GPS is kept as a cross-check.
- **Each car:** make, model, engine capacity and registration. Techs add these in the app or under **My logbook** on the website.
- **Logbook periods:** start date and opening odometer, then end date and closing odometer. Total km, business km and the business-use percentage are calculated automatically.
- **30 June odometer readings:** recorded for each year the logbook is relied on.

**Checks in the logbook report:**
- a period under 12 weeks (84 days)
- odometer gaps between trips, which are unlogged driving and count as non-business
- overlapping readings
- trips with no odometer readings
- vague reasons like "work"
- missing car details

The report prints or saves as a PDF laid out as an ATO logbook.

**Privacy:** private trips never store a location, and the office can't see them. Logbook periods and odometer readings are visible only to the tech.

**Techs' access:** techs sign in to the website with their staff code and PIN to see **My logbook**. Office admins also get a My logbook tab for their own car. Before deactivating someone who's leaving, remind them to download their report and CSV. They need to keep their records for five years after lodging.

**Payroll:** the Trips tab splits each person's per-km payments into two parts:
- the part at or under the ATO rate within the first 5,000 business km of the financial year, where no withholding is needed
- the rest, where withholding may apply

Set **Settings > ATO cents-per-km rate** each July. It's 91c for 2026–27. Report the payments as a cents-per-km allowance through STP, and confirm the treatment with your payroll provider or accountant.

This is record-keeping software, not tax advice.

## Who can use Work kms

Each staff member has a **Work kms** switch on the dashboard's Staff tab. Only people switched on can sign in, and switching someone off signs them out of the app straight away. Their trips and logbook stay on record. Office admins always have access. Staff who existed before this switch was added keep access; new staff start switched off unless you tick **Can use Work kms** when adding them.

## Privacy

- With drive detection **off** (the default), GPS only runs between **Start GPS trip** and **Finish trip**.
- With drive detection **on** (each tech chooses this in Settings), the phone watches for the car leaving where it was parked and measures every drive. Detected drives stay on the tech's phone until they mark them Business or Private. Nothing goes to the server before that.
- Only start and end coordinates are kept, never the route, and only for business trips. Private trips are saved without any location, and the office can't see them.

Tell staff in writing what the app collects and why before rolling it out, and make clear drive detection is their choice. If anyone works in NSW or the ACT, those states have specific notice rules for workplace tracking.

## Automatic drive detection

Turned on per tech in the app's **Settings**. Needs location set to Always (iPhone) or Allow all the time (Android).

1. While parked, the phone only watches a 150 m circle around where the car stopped. This uses very little battery.
2. Leaving the circle starts GPS tracking. The few hundred metres before it noticed are added as a straight line.
3. Parked for 5 minutes ends the drive. Walks (never above 15 km/h for 10 minutes) and drives under 500 m are dropped.
4. The drive appears under **Trips to sort** with **Business**, **Private** and **✕** (not a drive in this car, like a bus or a lift).

Odometer readings for detected drives carry on from the car's last reading plus the GPS distance, and are marked ≈ in the logbook report. Techs should do an **Odometer check** in Settings about weekly. Trips after a check start from the real dash reading, and any difference shows up in the report.

The rules are in `mobile/src/lib/drive.ts` and are covered by tests. They haven't been tried on a real phone yet, so test-drive before rolling out.

## CarPlay

The iPhone app can show on the car's CarPlay screen: the trip in progress, **Start trip** / **Finish trip**, and **Trips to sort**. A drive can be marked Private there, or Business to add the job on the phone later. With drive detection on, plugging into CarPlay starts a trip and unplugging ends it.

CarPlay is **off in builds by default**, because Apple has to approve it first:

1. Request the CarPlay **Driving Task** entitlement at developer.apple.com/contact/carplay (signed in with your Apple Developer account). Describe it as a mileage logbook for work trips. Approval can take a while.
2. Once approved, go to developer.apple.com > Certificates, Identifiers & Profiles > Identifiers > `tracking.workms` and check the CarPlay entitlement is listed.
3. In `mobile/eas.json`, change `"CARPLAY": "0"` to `"CARPLAY": "1"` in the `production` profile.
4. Rebuild with `npx eas-cli@latest build -p ios --profile production`. If EAS asks to update the provisioning profile, say yes.

Without the approval, a build with `CARPLAY=1` fails at signing. Builds with `CARPLAY=0` are unaffected. The CarPlay code is in `mobile/modules/work-kms-carplay` and `mobile/plugins/withCarPlay.js`.

---

## Deploy

### 1. Railway

1. Push this folder to a GitHub repo.
2. In Railway: **New Project > Deploy from GitHub repo**, and pick the repo. It reads `railway.json`, runs `npm run build` (installs the server and builds the dashboard), then `npm start`.
3. In the same project, click **New > Database > PostgreSQL**.
4. Open the web service's **Variables** tab and add:
   - `DATABASE_URL` = `${{Postgres.DATABASE_URL}}` (a reference variable, so it uses Railway's private network)
   - `JWT_SECRET` = a long random string. You can generate one with `openssl rand -base64 48`.
5. Redeploy. The first start creates the tables. `/api/health` should return `{"ok":true}`.

### 2. Create your admin login

With the Railway CLI linked to the project (`railway link`), from the repo root:

```bash
npm install --prefix server
railway run node server/scripts/create-admin.js --code yourcode --name "Your Name"
```

It asks for a password (10+ characters). This runs on your computer using Railway's variables, so if the private database URL doesn't resolve locally, temporarily use the Postgres service's public `DATABASE_PUBLIC_URL` instead:

```bash
DATABASE_URL="<DATABASE_PUBLIC_URL value>" JWT_SECRET=anything-32-chars-long-xxxxxxxxxxx node server/scripts/create-admin.js --code yourcode --name "Your Name"
```

Running it again for the same code resets that admin's password.

### 3. Cloudflare domain

1. In Railway: service **Settings > Networking > Custom Domain**, and enter something like `kms.yourdomain.com.au`. Railway shows a CNAME target and a TXT verification record.
2. In Cloudflare DNS, add both records exactly as Railway shows them.
3. If you leave the CNAME proxied (orange cloud), set **SSL/TLS > Overview** to **Full**. Flexible causes redirect loops.
4. Open `https://kms.yourdomain.com.au` and sign in. Then:
   - **Vehicles**: add the fleet.
   - **Staff**: add each tech with a staff code and 6-digit PIN.
   - **Settings**: set the company name and the per-km rate you reimburse.

### 4. Phone app

Background GPS needs a real build. It won't work in the Expo Go app.

```bash
cd mobile
npm install
npx expo install --fix             # lines up package versions with the Expo SDK
cp .env.example .env               # set EXPO_PUBLIC_API_URL=https://kms.yourdomain.com.au
npm install -g eas-cli
eas login
eas build:configure
```

`EXPO_PUBLIC_API_URL` is baked into the build. If you change domains, rebuild the app.

| Route | Command | Notes |
|---|---|---|
| Android, direct install | `eas build -p android --profile preview` | Gives you an APK link to install straight on the phone. The quickest way to test. |
| iPhone, TestFlight | `eas build -p ios --profile production` then `eas submit -p ios` | Needs an Apple Developer account. Builds expire after 90 days. |
| App Store / Play Store | `production` profile + `eas submit` | Both stores review background location closely. Explain that it only runs during a trip the user starts, for work mileage records. Google Play also asks for a short video. |

For a company-only iPhone app without a public listing, ask Apple about **Custom Apps** through Apple Business Manager.

Change `bundleIdentifier` and `package` in `mobile/app.json` before your first store build if you want different app IDs.

---

## Local development

You need Postgres running locally, or you can point at a Railway database's public URL.

```bash
cp server/.env.example server/.env        # fill in DATABASE_URL and JWT_SECRET
npm install --prefix server && npm install --prefix dashboard
# terminal 1
cd server && node --env-file=.env --watch src/index.js
# terminal 2
npm run dev:dashboard                      # http://localhost:5173, proxies /api to :3000
```

To point the phone app at your computer, set `EXPO_PUBLIC_API_URL=http://YOUR-LAN-IP:3000`. Android only allows plain http in development builds.

## API

| Method | Path | Who | What |
|---|---|---|---|
| POST | `/api/auth/login` | anyone | `{staff_code, secret}` → `{token, profile}` |
| GET | `/api/me` | signed in | Your profile |
| GET | `/api/vehicles` | signed in | Active vehicles |
| GET | `/api/settings` | signed in | Company name, rate |
| POST | `/api/trips/sync` | signed in | Upload up to 200 of your trips → `{saved, rejected}` |
| GET | `/api/trips?since=YYYY-MM-DD` | signed in | Your trips |
| GET | `/api/admin/trips?from=&to=` | admin | Everyone's trips |
| GET/POST | `/api/admin/staff` | admin | List, add staff |
| POST | `/api/admin/staff/:id/reset` | admin | New PIN or password |
| POST | `/api/admin/staff/:id/active` | admin | Deactivate or reactivate |
| GET/POST/PATCH | `/api/admin/vehicles` | admin | Manage fleet |
| PUT | `/api/admin/settings` | admin | Company name, rate |

## How GPS distance is measured

- Updates arrive every 20 m or 5 s while a trip runs, including with the screen locked.
- Fixes less accurate than 50 m are ignored. So are movements smaller than 15 m, which stops distance creeping while parked, and jumps faster than 250 km/h.
- Expect GPS to read a few percent under the odometer on winding roads. Techs can adjust the km before saving, and the office still sees the original GPS figure.
- If the phone kills the app mid-trip, tracking restarts the next time it opens. The gap is counted as a straight line.

## Running costs

- **Railway**: one small service plus Postgres. This should fit comfortably on the Hobby plan's usage for a small team. Check Railway's current pricing, and turn on Postgres backups.
- **Cloudflare**: free plan is fine.
- **Expo EAS**: the free plan's monthly builds are plenty.
- **Apple Developer**: an annual fee, needed for any iPhone distribution.

## Project layout

```
package.json, railway.json      build + start for Railway
server/src/index.js             Express app, serves API and dashboard
server/src/schema.sql           tables (run automatically on start)
server/src/auth.js              PIN/password login, tokens, lockout
server/src/routes/trips.js      tech trip sync with validation
server/src/routes/admin.js      office endpoints
server/scripts/create-admin.js  bootstrap the first admin
dashboard/src/                  React/Vite office dashboard
mobile/src/lib/tracking.ts      background GPS task
mobile/src/lib/trips.ts         offline storage and sync
mobile/src/lib/api.ts           API client and sign-in
mobile/src/screens/             Login, Home, Trip form
```
