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
  updated_at?: string;
};

type Stored = Trip & { _dirty?: boolean };

const tripsKey = (uid: string) => `trips:${uid}`;
const vehiclesKey = "vehicles:v1";
const lastOdoKey = (uid: string) => `lastOdo:${uid}`;
const logbooksKey = (uid: string) => `logbooks:${uid}`;

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

/** Highest odometer reading known for a car: from trips on this phone or the server's record. */
export async function lastOdometer(uid: string, vehicle?: Vehicle | null): Promise<number | null> {
  if (!vehicle) return null;
  const local = (await readLocal(uid))
    .filter((t) => t.vehicle_id === vehicle.id && !t.deleted && t.end_odo != null)
    .reduce((m, t) => Math.max(m, Number(t.end_odo)), 0);
  const best = Math.max(local, Number(vehicle.last_odo ?? 0));
  return best > 0 ? best : null;
}

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
}
