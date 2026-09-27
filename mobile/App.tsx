import { StatusBar } from "expo-status-bar";
import React, { useEffect, useState } from "react";
import { ActivityIndicator, Alert, Text, View } from "react-native";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { API_URL } from "./src/config";
import { getCachedProfile, getToken, onSignedOut, Profile, refreshProfile, signOutLocal } from "./src/lib/api";
import { discardTracking, Tracking } from "./src/lib/tracking";
import { clearLocal, pendingCount, sync, Trip } from "./src/lib/trips";
import HomeScreen from "./src/screens/HomeScreen";
import LoginScreen from "./src/screens/LoginScreen";
import TripFormScreen from "./src/screens/TripFormScreen";
import { useColors } from "./src/theme";

type Route =
  | { name: "home" }
  | { name: "form"; kind: "new" }
  | { name: "form"; kind: "gps"; tracking: Tracking }
  | { name: "form"; kind: "edit"; trip: Trip };

export default function App() {
  const c = useColors();
  const [profile, setProfile] = useState<Profile | null | undefined>(undefined);
  const [notice, setNotice] = useState<string | undefined>();
  const [route, setRoute] = useState<Route>({ name: "home" });

  useEffect(() => {
    (async () => {
      // Works offline: a saved token plus the cached profile is enough to open the app.
      const [token, cached] = await Promise.all([getToken(), getCachedProfile()]);
      setProfile(token && cached ? cached : null);
      if (token) {
        const fresh = await refreshProfile();
        if (fresh) setProfile(fresh);
      }
    })();
    return onSignedOut(() => {
      setNotice("Your session ended (PIN changed, account updated, or it's been 60 days). Sign in again. Your saved trips are still on this phone.");
      setProfile(null);
      setRoute({ name: "home" });
    });
  }, []);

  const signOut = async () => {
    if (!profile) return;
    await sync(profile.id).catch(() => {});
    const pending = await pendingCount(profile.id);
    const go = async () => {
      await discardTracking();
      await clearLocal(profile.id);
      await signOutLocal();
      setNotice(undefined);
      setProfile(null);
      setRoute({ name: "home" });
    };
    Alert.alert(
      "Sign out?",
      pending
        ? `${pending} trip${pending === 1 ? " hasn't" : "s haven't"} uploaded yet and will be lost if you sign out. Get some signal first if you can.`
        : "Your trips are all uploaded.",
      [{ text: "Cancel", style: "cancel" }, { text: "Sign out", style: pending ? "destructive" : "default", onPress: go }]
    );
  };

  let body: React.ReactNode;
  if (!API_URL) {
    body = <Centered><Text style={{ color: c.ink, textAlign: "center" }}>Set EXPO_PUBLIC_API_URL in the .env file, then restart the app.</Text></Centered>;
  } else if (profile === undefined) {
    body = <Centered><ActivityIndicator color={c.ink} /></Centered>;
  } else if (!profile) {
    body = <LoginScreen notice={notice} onSignedIn={(p) => { setNotice(undefined); setProfile(p); }} />;
  } else if (route.name === "form") {
    body = (
      <TripFormScreen
        uid={profile.id}
        kind={route.kind}
        trip={route.kind === "edit" ? route.trip : undefined}
        tracking={route.kind === "gps" ? route.tracking : undefined}
        onDone={() => setRoute({ name: "home" })}
      />
    );
  } else {
    body = (
      <HomeScreen
        profile={profile}
        onLog={() => setRoute({ name: "form", kind: "new" })}
        onSaveGps={(t) => setRoute({ name: "form", kind: "gps", tracking: t })}
        onEdit={(trip) => setRoute({ name: "form", kind: "edit", trip })}
        onSignOut={signOut}
      />
    );
  }

  return (
    <SafeAreaProvider>
      <StatusBar style="auto" />
      <View style={{ flex: 1, backgroundColor: c.bg }}>{body}</View>
    </SafeAreaProvider>
  );
}

function Centered({ children }: { children: React.ReactNode }) {
  return <View style={{ flex: 1, alignItems: "center", justifyContent: "center", padding: 24 }}>{children}</View>;
}
