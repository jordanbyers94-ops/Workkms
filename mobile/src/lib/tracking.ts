import AsyncStorage from "@react-native-async-storage/async-storage";
import * as Location from "expo-location";
import * as TaskManager from "expo-task-manager";
import { AutoState, decide, Decision, LatLng, MoveAnchor, noteFix } from "./drive";
import { haversine, Point, step } from "./geo";

export const TRACKING_TASK = "work-kms-trip-tracking";
const KEY = "tracking:v1";

export type Tracking = {
  status: "tracking" | "done";
  vehicle_id?: string;
  start_odo?: number;
  startedAt: number;
  endedAt?: number;
  meters: number;
  last?: Point;
  start?: { lat: number; lng: number };
  end?: { lat: number; lng: number };
  accuracy?: number;
  lastFixAt?: number;
  // Automatic drive detection
  auto?: boolean;
  via?: "manual" | "auto" | "carplay";
  maxSpeed?: number;
  moveAnchor?: MoveAnchor;
  startedFrom?: LatLng; // where the car was parked before the drive was detected
};

export async function getTracking(): Promise<Tracking | null> {
  try {
    const raw = await AsyncStorage.getItem(KEY);
    return raw ? (JSON.parse(raw) as Tracking) : null;
  } catch {
    return null;
  }
}
export async function setTracking(t: Tracking | null) {
  if (t) await AsyncStorage.setItem(KEY, JSON.stringify(t));
  else await AsyncStorage.removeItem(KEY);
}

const autoState = (t: Tracking): AutoState => ({
  startedAt: t.startedAt,
  meters: t.meters,
  maxSpeed: t.maxSpeed ?? 0,
  moveAnchor: t.moveAnchor,
});

function applyFixes(t: Tracking, locations: Location.LocationObject[]): Tracking {
  const next = { ...t };
  for (const loc of locations) {
    const fix: Point = { lat: loc.coords.latitude, lng: loc.coords.longitude, t: loc.timestamp };
    const acc = loc.coords.accuracy ?? 999;
    next.accuracy = Math.round(acc);
    next.lastFixAt = loc.timestamp;
    if (next.auto) {
      const s = noteFix(autoState(next), { ...fix, speed: loc.coords.speed ?? null, accuracy: acc }, next.last);
      next.maxSpeed = s.maxSpeed;
      next.moveAnchor = s.moveAnchor;
    }
    const { add, anchor } = step(next.last, fix, acc);
    if (anchor) {
      if (!next.start) {
        if (next.startedFrom) {
          // The drive was noticed a few hundred metres after leaving: count that bit as a straight line.
          const gap = haversine(next.startedFrom, fix);
          if (gap < 3000) next.meters += gap;
          next.start = next.startedFrom;
        } else {
          next.start = { lat: fix.lat, lng: fix.lng };
        }
      }
      next.meters += add;
      next.last = fix;
    }
  }
  return next;
}

// auto.ts registers what to do when an automatic trip ends, and how to refresh CarPlay.
type Hooks = { onDecision?: (d: Decision) => Promise<void>; onChange?: () => Promise<void> };
const hooks: Hooks = {};
export const setTrackingHooks = (h: Hooks) => Object.assign(hooks, h);

/** Check whether an automatic trip has ended (also called when the app is open, with no new fix). */
export async function checkAutoStop(now = Date.now()) {
  const t = await getTracking();
  if (!t || t.status !== "tracking" || !t.auto) return;
  const d = decide(autoState(t), now);
  if (d.action !== "continue") await hooks.onDecision?.(d);
}

// Runs in the background, including when the app is closed on Android and
// suspended on iOS. Must be defined at module load (see index.ts).
TaskManager.defineTask(TRACKING_TASK, async ({ data, error }) => {
  if (error) return;
  const { locations } = (data ?? {}) as { locations?: Location.LocationObject[] };
  if (!locations?.length) return;
  const t = await getTracking();
  if (!t || t.status !== "tracking") return;
  await setTracking(applyFixes(t, locations));
  await checkAutoStop(locations[locations.length - 1].timestamp);
  await hooks.onChange?.();
});

const notification = {
  notificationTitle: "Work trip in progress",
  notificationBody: "Measuring kms for your logbook. Open the app to finish the trip.",
  notificationColor: "#F4C21B",
};

const UPDATE_OPTIONS: Location.LocationTaskOptions = {
  accuracy: Location.Accuracy.BestForNavigation,
  distanceInterval: 20,
  timeInterval: 5000,
  activityType: Location.ActivityType.AutomotiveNavigation,
  pausesUpdatesAutomatically: false,
  showsBackgroundLocationIndicator: true,
  foregroundService: notification,
};

// Automatic trips need updates while parked too, so they can tell the drive has ended.
const AUTO_OPTIONS: Location.LocationTaskOptions = {
  ...UPDATE_OPTIONS,
  distanceInterval: 0,
  timeInterval: 10000,
  foregroundService: {
    ...notification,
    notificationTitle: "Drive detected",
    notificationBody: "Measuring kms. It stops by itself when you've been parked for 5 minutes.",
  },
};

export class PermissionError extends Error {}

export async function ensureAlwaysPermission() {
  const fg = await Location.requestForegroundPermissionsAsync();
  if (fg.status !== "granted") {
    throw new PermissionError("Location access is off for Work kms. Turn it on in your phone's Settings to track trips by GPS.");
  }
  const bg = await Location.requestBackgroundPermissionsAsync();
  if (bg.status !== "granted") {
    throw new PermissionError(
      "GPS trips need location set to \"Always\" (iPhone) or \"Allow all the time\" (Android) so tracking keeps going when your screen locks. You can change it in your phone's Settings under Work kms."
    );
  }
}

export async function hasAlwaysPermission() {
  try {
    return (await Location.getBackgroundPermissionsAsync()).status === "granted";
  } catch {
    return false;
  }
}

export async function startTracking(opts: { vehicle_id: string; start_odo: number }): Promise<void> {
  await ensureAlwaysPermission();
  await setTracking({ status: "tracking", via: "manual", startedAt: Date.now(), meters: 0, vehicle_id: opts.vehicle_id, start_odo: opts.start_odo });
  await Location.startLocationUpdatesAsync(TRACKING_TASK, UPDATE_OPTIONS);
  await hooks.onChange?.();
}

/** Start an automatic trip. Safe to call from the background: it never asks for permission. */
export async function startAutoTracking(opts: { vehicle_id: string; via: "auto" | "carplay"; from?: LatLng }) {
  if (!(await hasAlwaysPermission())) return false;
  const now = Date.now();
  await setTracking({
    status: "tracking",
    auto: true,
    via: opts.via,
    startedAt: now,
    meters: 0,
    maxSpeed: 0,
    vehicle_id: opts.vehicle_id,
    startedFrom: opts.from,
    moveAnchor: opts.from ? { ...opts.from, t: now } : undefined,
  });
  await Location.startLocationUpdatesAsync(TRACKING_TASK, AUTO_OPTIONS);
  await hooks.onChange?.();
  return true;
}

export async function isTrackingRunning() {
  try {
    return await Location.hasStartedLocationUpdatesAsync(TRACKING_TASK);
  } catch {
    return false;
  }
}

export async function stopUpdates() {
  if (await isTrackingRunning()) await Location.stopLocationUpdatesAsync(TRACKING_TASK);
}

export async function finishTracking(): Promise<Tracking | null> {
  await stopUpdates();
  const t = await getTracking();
  if (!t) return null;
  const done: Tracking = {
    ...t,
    status: "done",
    endedAt: Date.now(),
    end: t.last ? { lat: t.last.lat, lng: t.last.lng } : t.end,
  };
  await setTracking(done);
  await hooks.onChange?.();
  return done;
}

export async function discardTracking() {
  await stopUpdates();
  await setTracking(null);
  await hooks.onChange?.();
}

/** If the app was killed and the OS dropped the task, restart it so the trip keeps measuring. */
export async function resumeIfNeeded() {
  const t = await getTracking();
  if (t?.status === "tracking" && !(await isTrackingRunning()) && (await hasAlwaysPermission())) {
    await Location.startLocationUpdatesAsync(TRACKING_TASK, t.auto ? AUTO_OPTIONS : UPDATE_OPTIONS);
  }
}
