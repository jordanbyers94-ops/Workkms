export type Point = { lat: number; lng: number; t: number };

export function haversine(a: { lat: number; lng: number }, b: { lat: number; lng: number }) {
  const R = 6371000;
  const rad = (x: number) => (x * Math.PI) / 180;
  const dLat = rad(b.lat - a.lat);
  const dLng = rad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

export const MAX_ACCURACY_M = 50; // ignore fixes worse than this
export const MIN_STEP_M = 15;     // ignore wobble while stopped
export const MAX_SPEED_MS = 70;   // ~250 km/h, anything faster is a bad fix

/** Returns metres to add (0 if the fix should be skipped) and whether it becomes the new anchor point. */
export function step(last: Point | undefined, fix: Point, accuracy: number): { add: number; anchor: boolean } {
  if (accuracy > MAX_ACCURACY_M) return { add: 0, anchor: false };
  if (!last) return { add: 0, anchor: true };
  const d = haversine(last, fix);
  const dt = Math.max((fix.t - last.t) / 1000, 0.001);
  if (d < Math.max(MIN_STEP_M, accuracy)) return { add: 0, anchor: false };
  if (d / dt > MAX_SPEED_MS) return { add: 0, anchor: false };
  return { add: d, anchor: true };
}
