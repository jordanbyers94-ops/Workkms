// The background tracking task must be registered before anything else loads,
// so the OS can wake the app with location updates even when it's closed.
import "./src/lib/tracking";
// Drive detection (geofence task) and the CarPlay screen wiring
import "./src/lib/auto";
import { registerRootComponent } from "expo";
import App from "./App";

registerRootComponent(App);
