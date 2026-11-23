// Talks to the native CarPlay screen (modules/work-kms-carplay). On Android, and on iPhone builds
// made without CarPlay switched on, the native part isn't there and everything here does nothing.
import { requireOptionalNativeModule } from "expo";

export type CarPlayAction =
  | { type: "connected" }
  | { type: "disconnected" }
  | { type: "start" }
  | { type: "finish" }
  | { type: "tag"; id: string; as: "business" | "private" };

export type CarPlayState = {
  signedIn: boolean;
  autoOn: boolean;
  tracking: { km: number; minutes: number; auto: boolean } | null;
  toSort: { id: string; title: string; detail: string; tag: "business" | "private" | null }[];
};

type NativeModule = {
  setState(json: string): void;
  takeActions(): string;
  isConnected(): boolean;
  isEnabled(): boolean;
  addListener(event: "onAction", listener: () => void): { remove(): void };
};

const Native = requireOptionalNativeModule<NativeModule>("WorkKmsCarPlay");

/** True only in iPhone builds made with CarPlay switched on. */
export const carPlayBuiltIn = (() => {
  try {
    return Native?.isEnabled() ?? false;
  } catch {
    return false;
  }
})();

export function isCarPlayConnected() {
  try {
    return Native?.isConnected() ?? false;
  } catch {
    return false;
  }
}

export function publishCarPlay(state: CarPlayState) {
  try {
    Native?.setState(JSON.stringify(state));
  } catch {
    // CarPlay is a nice-to-have; never let it break tracking
  }
}

/** Calls handler for each button press on the car screen, including ones made before JS was listening. */
export function listenCarPlay(handler: (a: CarPlayAction) => Promise<void>) {
  if (!Native) return () => {};
  let running = Promise.resolve();
  const drain = () => {
    running = running.then(async () => {
      let list: CarPlayAction[] = [];
      try {
        list = JSON.parse(Native.takeActions() || "[]");
      } catch {
        list = [];
      }
      for (const a of list) {
        try {
          await handler(a);
        } catch {
          // keep going with the next action
        }
      }
    });
  };
  const sub = Native.addListener("onAction", drain);
  drain();
  return () => sub.remove();
}
