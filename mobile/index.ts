// The background tracking task must be registered before anything else loads,
// so the OS can wake the app with location updates even when it's closed.
import "./src/lib/tracking";
import { registerRootComponent } from "expo";
import App from "./App";

registerRootComponent(App);
