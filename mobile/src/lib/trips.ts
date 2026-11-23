import AsyncStorage from "@react-native-async-storage/async-storage";
import * as Crypto from "expo-crypto";
import { fyOf, fyStartISO, todayISO } from "./dates";
import { api, ApiError, Logbook, Vehicle } from "./api";

export type Source = "gps" | "odometer" | "manual";

export type Trip = {
  id: string;
  user_id: string;
  vehicle_id: string | null;
  trip_date: string;
  end_date: string | null;
  trip_type: "business" | "private";
  started_at: string | null;
  ended_at: string | null;
  km: number;
  start_odo: number | null;
  end_odo: number | null;
  source: Source;
  gps_km: number | null;
  from_text: string | null;
  to_text: string | null;
  job_no: string | null;
  purpose: string | null;
  start_lat: number | null;
  start_lng: number | null;
  end_lat: number | null;
  end_lng: number | null;
  deleted: boolean;
  auto_detected?: boolean;  // found by automatic drive detection or started from CarPlay
  odo_estimated?: boolean;  // odometer readings worked out from GPS, not read off the dash
  updated_at?: string;
};

/** A drive found automatically (or finished from CarPlay), waiting on this phone to be sorted. */
export type AutoTrip = {
  id: string;
  startedAt: number;
  endedAt: number;
  meters: number;
  vehicle_id: string;
  start_odo: number | null;
  end_odo: number | null;
  odo_estimated: boolean;
  start?: { lat: number; lng: number };
  end?: { lat: number; lng: number };
  via: "auto" | "carplay" | "manual";
  tag?: "business" | "private"; // chosen on CarPlay, details still to add
};

type Stored = Trip & { _dirty?: boolean };

const tripsKey = (uid: string) => `trips:${uid}`;
const vehiclesKey = "vehicles:v1";
const lastOdoKey = (uid: string) => `lastOdo:${uid}`;
const logbooksKey = (uid: string) => `logbooks:${uid}`;
const toSortKey = (uid: string) => `tosort:${uid}`;
const odoCheckKey = (uid: string) => `odocheck:${uid}`;
type OdoCheck = { vehicle_id: string; odo: number; at: number };

export const newTripId = () => Crypto.randomUUID();

async function readLocal(uid: string): Promise<Stored[]> {
  try {
    const raw = await AsyncStorage.getItem(tripsKey(uid));
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}
async function writeLocal(uid: string, list: Stored[]) {
  await AsyncStorage.setItem(tripsKey(uid), JSON.stringify(list));
}

export async function listTrips(uid: string): Promise<Trip[]> {
  const all = await readLocal(uid);
  return all
    .filter((t) => !t.deleted)
    .sort((a, b) => (a.trip_date < b.trip_date ? 1 : a.trip_date > b.trip_date ? -1 : (b.started_at ?? "").localeCompare(a.started_at ?? "")));
}

export async function pendingCount(uid: string) {
  return (await readLocal(uid)).filter((t) => t._dirty).length;
}

/** Save locally first (works with no signal), then try to sync. */
export async function saveTrip(uid: string, trip: Trip) {
  const all = await readLocal(uid);
  const i = all.findIndex((t) => t.id === trip.id);
  const row: Stored = { ...trip, user_id: uid, _dirty: true };
  if (i >= 0) all[i] = row;
  else all.push(row);
  await writeLocal(uid, all);
  sync(uid).catch(() => {});
}

export async function deleteTrip(uid: string, trip: Trip) {
  await saveTrip(uid, { ...trip, deleted: true });
}

/**
 * Best guess at a car's odometer now: the highest reading from trips, trips waiting to be sorted and
 * the server's record, unless an odometer check on this phone is newer than all of them.
 */
export async function lastOdometer(uid: string, vehicle?: Vehicle | null): Promise<number | null> {
  if (!vehicle) return null;
  const trips = (await readLocal(uid)).filter((t) => t.vehicle_id === vehicle.id && !t.deleted && t.end_odo != null);
  const sorts = (await getToSort(uid)).filter((a) => a.vehicle_id === vehicle.id && a.end_odo != null);
  const check = (await getOdoChecks(uid)).find((c) => c.vehicle_id === vehicle.id);
  const tripTime = (t: Trip) => (t.ended_at ? Date.parse(t.ended_at) : Date.parse(`${t.end_date ?? t.trip_date}T23:59:00`));
  const latest = Math.max(0, ...trips.map(tripTime), ...sorts.map((a) => a.endedAt));
  if (check && check.at >= latest) return check.odo;
  const best = Math.max(
    Number(vehicle.last_odo ?? 0),
    check?.odo ?? 0,
    ...trips.map((t) => Number(t.end_odo)),
    ...sorts.map((a) => Number(a.end_odo))
  );
  return best > 0 ? best : null;
}

async function readJson<T>(key: string, fallback: T): Promise<T> {
  try {
    const raw = await AsyncStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

export const getToSort = (uid: string) => readJson<AutoTrip[]>(toSortKey(uid), []);
export async function setToSort(uid: string, list: AutoTrip[]) {
  await AsyncStorage.setItem(toSortKey(uid), JSON.stringify(list.sort((a, b) => a.startedAt - b.startedAt)));
}
export async function addToSort(uid: string, trip: AutoTrip) {
  const list = await getToSort(uid);
  await setToSort(uid, [...list.filter((a) => a.id !== trip.id), trip]);
}
/** Remove a drive from the list. If it wasn't a real drive in that car, later estimates move back. */
export async function removeToSort(uid: string, id: string, discarded: boolean) {
  const list = await getToSort(uid);
  const gone = list.find((a) => a.id === id);
  let rest = list.filter((a) => a.id !== id);
  if (discarded && gone && gone.start_odo != null && gone.end_odo != null) {
    const km = gone.end_odo - gone.start_odo;
    rest = rest.map((a) =>
      a.vehicle_id === gone.vehicle_id && a.odo_estimated && a.startedAt > gone.startedAt && a.start_odo != null && a.end_odo != null
        ? { ...a, start_odo: Math.round((a.start_odo - km) * 10) / 10, end_odo: Math.round((a.end_odo - km) * 10) / 10 }
        : a
    );
  }
  await setToSort(uid, rest);
}

const getOdoChecks = (uid: string) => readJson<OdoCheck[]>(odoCheckKey(uid), []);

/** Record a reading off the dash. Needs signal, so it's on the server for the logbook. */
export async function saveOdoCheck(uid: string, vehicle_id: string, odo: number) {
  await api("/my/readings", { method: "POST", body: { vehicle_id, reading_date: todayISO(), odo, note: "Odometer check" } });
  const list = (await getOdoChecks(uid)).filter((c) => c.vehicle_id !== vehicle_id);
  await AsyncStorage.setItem(odoCheckKey(uid), JSON.stringify([...list, { vehicle_id, odo, at: Date.now() }]));
}

/** Cars saved on this phone, without going to the network (safe in the background). */
export const cachedVehicles = () => readJson<Vehicle[]>(vehiclesKey, []);

let syncing: Promise<SyncResult> | null = null;
export type SyncResult = { ok: boolean; pending: number; message?: string };

/** Push unsynced trips, then pull this and last financial year from the server. */
export function sync(uid: string): Promise<SyncResult> {
  if (!syncing) syncing = doSync(uid).finally(() => { syncing = null; });
  return syncing;
}

async function doSync(uid: string): Promise<SyncResult> {
  const dirty = (await readLocal(uid)).filter((t) => t._dirty);
  const errors: string[] = [];

  try {
    // Push in batches of 100
    for (let i = 0; i < dirty.length; i += 100) {
      const batch = dirty.slice(i, i + 100);
      const payload = batch.map(({ _dirty, updated_at, ...t }) => t);
      const { saved, rejected } = await api<{ saved: string[]; rejected: { id: string; error: string }[] }>("/trips/sync", {
        method: "POST",
        body: { trips: payload },
      });
      const ok = new Set(saved);
      rejected.forEach((r) => errors.push(r.error));
      const all = (await readLocal(uid)).map((t) => (ok.has(t.id) && t._dirty ? stillSame(t, batch) : t));
      await writeLocal(uid, all);
    }

    // Pull this and last financial year
    const since = fyStartISO(fyOf(todayISO()) - 1);
    const { trips } = await api<{ trips: Trip[] }>(`/trips?since=${since}`);
    const local = await readLocal(uid);
    const localById = new Map(local.map((t) => [t.id, t]));
    const merged: Stored[] = [];
    const seen = new Set<string>();
    for (const s of trips) {
      const l = localById.get(s.id);
      merged.push(l?._dirty ? l : s);
      seen.add(s.id);
    }
    for (const l of local) if (!seen.has(l.id) && (l._dirty || l.trip_date < since)) merged.push(l);
    await writeLocal(uid, merged);
    const pending = merged.filter((t) => t._dirty).length;
    return { ok: !errors.length, pending, message: errors.length ? `Some trips were rejected: ${errors[0]}` : undefined };
  } catch (e) {
    const pending = (await readLocal(uid)).filter((t) => t._dirty).length;
    return { ok: false, pending, message: e instanceof ApiError ? e.message : "Couldn't sync." };
  }
}

// If the trip was edited again while uploading, keep it marked dirty.
function stillSame(current: Stored, sent: Stored[]): Stored {
  const s = sent.find((x) => x.id === current.id);
  if (s && JSON.stringify({ ...s, _dirty: 0 }) === JSON.stringify({ ...current, _dirty: 0 })) {
    const { _dirty, ...clean } = current;
    return clean;
  }
  return current;
}

export async function getVehicles(): Promise<Vehicle[]> {
  try {
    const { vehicles } = await api<{ vehicles: Vehicle[] }>("/vehicles");
    await AsyncStorage.setItem(vehiclesKey, JSON.stringify(vehicles));
    return vehicles;
  } catch {
    try {
      return JSON.parse((await AsyncStorage.getItem(vehiclesKey)) ?? "[]");
    } catch {
      return [];
    }
  }
}

/** Needs signal: cars are saved straight to the server. */
export async function addVehicle(v: { name: string; make: string; model: string; engine: string; rego: string; is_car: boolean }) {
  const { vehicle } = await api<{ vehicle: Vehicle }>("/my/vehicles", { method: "POST", body: v });
  await getVehicles();
  return vehicle;
}

/** Logbook periods still running, cached for offline use. */
export async function getOpenLogbooks(uid: string): Promise<Logbook[]> {
  try {
    const { logbooks } = await api<{ logbooks: Logbook[] }>("/my/logbooks");
    const open = logbooks.filter((l) => !l.end_date);
    await AsyncStorage.setItem(logbooksKey(uid), JSON.stringify(open));
    return open;
  } catch {
    try {
      return JSON.parse((await AsyncStorage.getItem(logbooksKey(uid))) ?? "[]");
    } catch {
      return [];
    }
  }
}

export async function clearLocal(uid: string) {
  await AsyncStorage.removeItem(tripsKey(uid));
  await AsyncStorage.removeItem(lastOdoKey(uid));
  await AsyncStorage.removeItem(logbooksKey(uid));
  await AsyncStorage.removeItem(toSortKey(uid));
  await AsyncStorage.removeItem(odoCheckKey(uid));
}
