import React, { useEffect, useRef, useState } from "react";
import { AppState, View, ActivityIndicator } from "react-native";
import { StatusBar } from "expo-status-bar";
import { colors } from "./src/theme";
import { hasWallet, isLocked, cacheSession, WalletData } from "./src/lib/vault";
import { Welcome } from "./src/screens/Welcome";
import { CreateWallet } from "./src/screens/CreateWallet";
import { ImportWallet } from "./src/screens/ImportWallet";
import { Unlock } from "./src/screens/Unlock";
import { Dashboard } from "./src/screens/Dashboard";

type Route = "loading" | "welcome" | "create" | "import" | "unlock" | "dashboard";

export default function App() {
  const [route, setRoute] = useState<Route>("loading");
  const routeRef = useRef(route);
  routeRef.current = route;

  useEffect(() => {
    (async () => {
      setRoute((await hasWallet()) ? "unlock" : "welcome");
    })();
  }, []);

  // Re-check the lock whenever the app returns to the foreground.
  useEffect(() => {
    const sub = AppState.addEventListener("change", (state) => {
      if (state === "active" && routeRef.current === "dashboard" && isLocked()) {
        setRoute("unlock");
      }
    });
    return () => sub.remove();
  }, []);

  function handleOnboarded(wallet: WalletData, id: string) {
    // Fresh wallet was just created or imported: open the session directly.
    cacheSession([{ id, name: "Wallet 1", wallet }], id);
    setRoute("dashboard");
  }

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      <StatusBar style="light" />
      {route === "loading" && (
        <View style={{ flex: 1, alignItems: "center", justifyContent: "center" }}>
          <ActivityIndicator color={colors.purpleLight} />
        </View>
      )}
      {route === "welcome" && (
        <Welcome onCreate={() => setRoute("create")} onImport={() => setRoute("import")} />
      )}
      {route === "create" && (
        <CreateWallet onDone={handleOnboarded} onBack={() => setRoute("welcome")} />
      )}
      {route === "import" && (
        <ImportWallet onDone={handleOnboarded} onBack={() => setRoute("welcome")} />
      )}
      {route === "unlock" && <Unlock onUnlock={() => setRoute("dashboard")} />}
      {route === "dashboard" && <Dashboard onLock={() => setRoute("unlock")} />}
    </View>
  );
}
