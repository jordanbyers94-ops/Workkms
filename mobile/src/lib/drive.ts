// Pure rules for automatic drive detection. No storage or OS calls here, so they can be tested.
import { haversine } from "./geo";

export const GEOFENCE_RADIUS_M = 150;      // leaving this circle around the last stop starts a drive
export const MOVE_RADIUS_M = 120;          // moving further than this counts as "still driving"
export const STOP_AFTER_MS = 5 * 60_000;   // parked this long = the drive has ended
export const WALK_CHECK_MS = 10 * 60_000;  // after this long, a "drive" that never went over...
export const DRIVING_SPEED_MS = 4.2;       // ...15 km/h is walking, so it's cancelled
export const MIN_TRIP_M = 500;             // shorter auto trips are dropped

export type LatLng = { lat: number; lng: number };
export type MoveAnchor = LatLng & { t: number };

export type AutoState = {
  startedAt: number;
  meters: number;
  maxSpeed: number;          // m/s
  moveAnchor?: MoveAnchor;   // where the car last moved from, and when
};

export type Fix = LatLng & { t: number; speed: number | null; accuracy: number };

/** Update the auto-trip state with a new GPS fix (distance is handled separately). */
export function noteFix(s: AutoState, fix: Fix, prev?: { lat: number; lng: number; t: number }): AutoState {
  const next = { ...s };
  let speed = fix.speed != null && fix.speed >= 0 ? fix.speed : null;
  if (speed == null && prev && fix.t > prev.t) speed = haversine(prev, fix) / ((fix.t - prev.t) / 1000);
  // Ignore speeds from poor fixes and impossible jumps
  if (speed != null && fix.accuracy <= 50 && speed < 70) next.maxSpeed = Math.max(next.maxSpeed, speed);
  if (fix.accuracy <= 100) {
    if (!next.moveAnchor || haversine(next.moveAnchor, fix) > MOVE_RADIUS_M) {
      next.moveAnchor = { lat: fix.lat, lng: fix.lng, t: fix.t };
    }
  }
  return next;
}

export type Decision = { action: "continue" } | { action: "end"; endedAt: number } | { action: "cancel" };

/** Should the auto trip keep going, end (parked), or be cancelled (it was a walk)? */
export function decide(s: AutoState, now: number): Decision {
  if (s.maxSpeed < DRIVING_SPEED_MS && now - s.startedAt > WALK_CHECK_MS) return { action: "cancel" };
  const anchorT = s.moveAnchor?.t ?? s.startedAt;
  if (now - anchorT > STOP_AFTER_MS) return { action: "end", endedAt: anchorT };
  return { action: "continue" };
}

/** Is a finished auto trip worth keeping? */
export function keepTrip(meters: number, maxSpeed: number, fromCarPlay: boolean) {
  if (meters < MIN_TRIP_M) return false;
  return fromCarPlay || maxSpeed >= DRIVING_SPEED_MS;
}
