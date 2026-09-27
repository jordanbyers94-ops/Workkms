import AsyncStorage from "@react-native-async-storage/async-storage";
import * as Location from "expo-location";
import * as TaskManager from "expo-task-manager";
import { Point, step } from "./geo";

export const TRACKING_TASK = "work-kms-trip-tracking";
const KEY = "tracking:v1";

export type Tracking = {
  status: "tracking" | "done";
  startedAt: number;
  endedAt?: number;
  meters: number;
  last?: Point;
  start?: { lat: number; lng: number };
  end?: { lat: number; lng: number };
  accuracy?: number;
  lastFixAt?: number;
};

export async function getTracking(): Promise<Tracking | null> {
  try {
    const raw = await AsyncStorage.getItem(KEY);
    return raw ? (JSON.parse(raw) as Tracking) : null;
  } catch {
    return null;
  }
}
async function setTracking(t: Tracking | null) {
  if (t) await AsyncStorage.setItem(KEY, JSON.stringify(t));
  else await AsyncStorage.removeItem(KEY);
}

function applyFixes(t: Tracking, locations: Location.LocationObject[]): Tracking {
  const next = { ...t };
  for (const loc of locations) {
    const fix: Point = { lat: loc.coords.latitude, lng: loc.coords.longitude, t: loc.timestamp };
    const acc = loc.coords.accuracy ?? 999;
    next.accuracy = Math.round(acc);
    next.lastFixAt = loc.timestamp;
    const { add, anchor } = step(next.last, fix, acc);
    if (anchor) {
      if (!next.start) next.start = { lat: fix.lat, lng: fix.lng };
      next.meters += add;
      next.last = fix;
    }
  }
  return next;
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
});

const UPDATE_OPTIONS: Location.LocationTaskOptions = {
    accuracy: Location.Accuracy.BestForNavigation,
    distanceInterval: 20,
    timeInterval: 5000,
    activityType: Location.ActivityType.AutomotiveNavigation,
    pausesUpdatesAutomatically: false,
    showsBackgroundLocationIndicator: true,
    foregroundService: {
      notificationTitle: "Work trip in progress",
      notificationBody: "Measuring kms for your logbook. Open the app to finish the trip.",
      notificationColor: "#F4C21B",
    },
  };

export class PermissionError extends Error {}

export async function startTracking(): Promise<void> {
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
  await setTracking({ status: "tracking", startedAt: Date.now(), meters: 0 });
  await Location.startLocationUpdatesAsync(TRACKING_TASK, UPDATE_OPTIONS);
}

export async function isTrackingRunning() {
  try {
    return await Location.hasStartedLocationUpdatesAsync(TRACKING_TASK);
  } catch {
    return false;
  }
}

export async function finishTracking(): Promise<Tracking | null> {
  if (await isTrackingRunning()) await Location.stopLocationUpdatesAsync(TRACKING_TASK);
  const t = await getTracking();
  if (!t) return null;
  const done: Tracking = {
    ...t,
    status: "done",
    endedAt: Date.now(),
    end: t.last ? { lat: t.last.lat, lng: t.last.lng } : t.end,
  };
  await setTracking(done);
  return done;
}

export async function discardTracking() {
  if (await isTrackingRunning()) await Location.stopLocationUpdatesAsync(TRACKING_TASK);
  await setTracking(null);
}

/** If the app was killed and the OS dropped the task, restart it so the trip keeps measuring. */
export async function resumeIfNeeded() {
  const t = await getTracking();
  if (t?.status === "tracking" && !(await isTrackingRunning())) {
    const bg = await Location.getBackgroundPermissionsAsync();
    if (bg.status === "granted") {
      await Location.startLocationUpdatesAsync(TRACKING_TASK, UPDATE_OPTIONS);
    }
  }
}
