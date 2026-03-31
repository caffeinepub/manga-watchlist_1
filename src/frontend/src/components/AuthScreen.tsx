import { useQueryClient } from "@tanstack/react-query";
import { BookOpen, Loader2 } from "lucide-react";
import { motion } from "motion/react";
import { useInternetIdentity } from "../hooks/useInternetIdentity";

export default function AuthScreen() {
  const { login, clear, loginStatus, identity, isLoggingIn } =
    useInternetIdentity();
  const queryClient = useQueryClient();
  const isAuthenticated = !!identity;

  const handleAuth = async () => {
    if (isAuthenticated) {
      await clear();
      queryClient.clear();
    } else {
      login();
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center hero-gradient relative overflow-hidden">
      {/* Background orbs */}
      <div className="absolute inset-0 overflow-hidden pointer-events-none">
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[600px] h-[600px] rounded-full bg-primary/5 blur-[120px]" />
        <div className="absolute top-1/3 left-1/3 w-[300px] h-[300px] rounded-full bg-primary/3 blur-[80px]" />
      </div>

      <motion.div
        initial={{ opacity: 0, y: 40 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.6, ease: "easeOut" }}
        className="relative z-10 flex flex-col items-center gap-10 text-center px-6"
      >
        {/* Icon */}
        <motion.div
          initial={{ scale: 0.8, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          transition={{ duration: 0.5, delay: 0.1 }}
          className="w-20 h-20 rounded-2xl gold-border flex items-center justify-center bg-card"
        >
          <BookOpen className="w-10 h-10 text-primary" strokeWidth={1.5} />
        </motion.div>

        {/* Headline */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, delay: 0.2 }}
          className="space-y-4"
        >
          <p className="text-muted-foreground text-base tracking-[0.2em] uppercase">
            Manga Watchlist
          </p>
          <p className="text-foreground/70 text-lg max-w-sm leading-relaxed">
            Connect your identity to access your personal collection.
          </p>
        </motion.div>

        {/* Login button */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, delay: 0.35 }}
          className="flex flex-col items-center gap-3"
        >
          <button
            type="button"
            data-ocid="auth.primary_button"
            onClick={handleAuth}
            disabled={isLoggingIn}
            className="px-10 py-3.5 rounded-full bg-primary text-primary-foreground font-semibold text-base tracking-wide hover:bg-accent transition-all duration-200 disabled:opacity-50 shadow-gold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            {isLoggingIn ? (
              <span className="flex items-center gap-2">
                <Loader2 className="w-4 h-4 animate-spin" />
                Connecting...
              </span>
            ) : (
              "Connect with Internet Identity"
            )}
          </button>

          {loginStatus === "loginError" && (
            <p
              data-ocid="auth.error_state"
              className="text-destructive text-sm"
            >
              Login failed. Please try again.
            </p>
          )}

          <p className="text-muted-foreground text-xs mt-2">
            Secure, decentralized identity — no passwords required.
          </p>
        </motion.div>
      </motion.div>
    </div>
  );
}
