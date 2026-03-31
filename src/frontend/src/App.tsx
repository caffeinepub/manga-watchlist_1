import { Toaster } from "@/components/ui/sonner";
import { Loader2 } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { useEffect } from "react";
import AuthScreen from "./components/AuthScreen";
import PasswordGate from "./components/PasswordGate";
import WatchlistScreen from "./components/WatchlistScreen";
import { useActor } from "./hooks/useActor";
import { useInternetIdentity } from "./hooks/useInternetIdentity";
import { useIsUnlocked } from "./hooks/useQueries";

function LoadingScreen() {
  return (
    <motion.div
      key="loading"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="min-h-screen flex items-center justify-center bg-background"
    >
      <div className="flex flex-col items-center gap-4">
        <Loader2 className="w-10 h-10 text-primary animate-spin" />
        <p className="text-muted-foreground text-sm tracking-widest uppercase">
          Loading...
        </p>
      </div>
    </motion.div>
  );
}

export default function App() {
  useEffect(() => {
    document.documentElement.classList.add("dark");
  }, []);

  // Register service worker for static asset caching
  useEffect(() => {
    if ("serviceWorker" in navigator) {
      navigator.serviceWorker.register("/sw.js").catch((err) => {
        console.warn("Service worker registration failed:", err);
      });
    }
  }, []);

  const { identity, isInitializing } = useInternetIdentity();
  const { isFetching: actorFetching, actor } = useActor();
  const isAuthenticated = !!identity;
  const isActorReady = isAuthenticated && !!actor && !actorFetching;

  const { data: isUnlocked = false, isLoadingUnlock } = useIsUnlocked();

  const isLoading =
    isInitializing ||
    (isAuthenticated && !isActorReady) ||
    (isActorReady && isLoadingUnlock);

  let screen: "loading" | "auth" | "gate" | "main";
  if (isLoading) {
    screen = "loading";
  } else if (!isAuthenticated) {
    screen = "auth";
  } else if (!isUnlocked) {
    screen = "gate";
  } else {
    screen = "main";
  }

  return (
    <div className="min-h-screen bg-background">
      <AnimatePresence mode="wait">
        {screen === "loading" && <LoadingScreen key="loading" />}
        {screen === "auth" && (
          <motion.div
            key="auth"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.3 }}
          >
            <AuthScreen />
          </motion.div>
        )}
        {screen === "gate" && (
          <motion.div
            key="gate"
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -20 }}
            transition={{ duration: 0.35 }}
          >
            <PasswordGate />
          </motion.div>
        )}
        {screen === "main" && (
          <motion.div
            key="main"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.4 }}
          >
            <WatchlistScreen />
          </motion.div>
        )}
      </AnimatePresence>
      <Toaster
        theme="dark"
        toastOptions={{
          style: {
            background: "oklch(0.14 0 0)",
            border: "1px solid oklch(0.72 0.14 73 / 0.4)",
            color: "oklch(0.93 0 0)",
          },
        }}
      />
    </div>
  );
}
