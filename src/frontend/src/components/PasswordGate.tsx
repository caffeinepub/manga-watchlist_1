import { useQueryClient } from "@tanstack/react-query";
import { AlertCircle, Eye, EyeOff, Loader2, Lock, Timer } from "lucide-react";
import { motion } from "motion/react";
import { type FormEvent, useEffect, useState } from "react";
import { useInternetIdentity } from "../hooks/useInternetIdentity";
import { useVerifyPassword } from "../hooks/useQueries";

export default function PasswordGate() {
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [attemptsLeft, setAttemptsLeft] = useState<number | null>(null);
  const [lockState, setLockState] = useState<"idle" | "error" | "locked">(
    "idle",
  );
  const [countdown, setCountdown] = useState(0);

  const { mutateAsync: verifyPassword, isPending } = useVerifyPassword();
  const { clear, identity } = useInternetIdentity();
  const queryClient = useQueryClient();

  // Countdown timer when locked
  useEffect(() => {
    if (lockState !== "locked" || countdown <= 0) return;
    const timer = setInterval(() => {
      setCountdown((prev) => {
        if (prev <= 1) {
          clearInterval(timer);
          setLockState("idle");
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
    return () => clearInterval(timer);
  }, [lockState, countdown]);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (!password.trim() || isPending || lockState === "locked") return;

    try {
      const result = await verifyPassword(password);
      if (result.__kind__ === "ok") {
        // Query invalidation in useVerifyPassword handles navigation
      } else if (result.__kind__ === "fail") {
        setAttemptsLeft(Number(result.fail));
        setLockState("error");
        setPassword("");
      } else if (result.__kind__ === "locked") {
        setCountdown(Number(result.locked));
        setLockState("locked");
        setPassword("");
      }
    } catch {
      setLockState("error");
    }
  };

  const handleLogout = async () => {
    await clear();
    queryClient.clear();
  };

  const formatTime = (secs: number) => {
    const m = Math.floor(secs / 60);
    const s = secs % 60;
    return m > 0 ? `${m}m ${s}s` : `${s}s`;
  };

  const principalShort = identity
    ? `${identity.getPrincipal().toString().slice(0, 12)}...`
    : null;

  return (
    <div className="min-h-screen flex items-center justify-center hero-gradient relative overflow-hidden">
      {/* Ambient glow */}
      <div className="absolute inset-0 overflow-hidden pointer-events-none">
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[500px] h-[500px] rounded-full bg-primary/5 blur-[100px]" />
      </div>

      <motion.div
        initial={{ opacity: 0, y: 30 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5 }}
        className="relative z-10 w-full max-w-md px-6"
      >
        <div
          data-ocid="gate.card"
          className="gold-border rounded-2xl bg-card p-8 space-y-6"
        >
          {/* Header */}
          <div className="flex flex-col items-center gap-3 text-center">
            <div className="w-14 h-14 rounded-xl gold-border flex items-center justify-center bg-secondary">
              <Lock className="w-7 h-7 text-primary" strokeWidth={1.5} />
            </div>
            <div>
              <p className="text-muted-foreground text-xs font-medium tracking-widest uppercase mb-1">
                Access Required
              </p>
              {principalShort && (
                <p className="text-muted-foreground/60 text-xs">
                  {principalShort}
                </p>
              )}
            </div>
          </div>

          {/* Form */}
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="relative">
              <input
                data-ocid="gate.input"
                type={showPassword ? "text" : "password"}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                disabled={isPending || lockState === "locked"}
                placeholder="Enter access password"
                className="w-full px-4 py-3 pr-12 rounded-xl bg-input border border-border text-foreground placeholder:text-muted-foreground/50 focus:outline-none focus:border-primary/60 focus:ring-1 focus:ring-primary/30 transition-all disabled:opacity-50 text-sm"
                autoComplete="current-password"
              />
              <button
                type="button"
                onClick={() => setShowPassword(!showPassword)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors p-1"
                aria-label={showPassword ? "Hide password" : "Show password"}
              >
                {showPassword ? (
                  <EyeOff className="w-4 h-4" />
                ) : (
                  <Eye className="w-4 h-4" />
                )}
              </button>
            </div>

            {/* Error states */}
            {lockState === "error" && attemptsLeft !== null && (
              <motion.div
                data-ocid="gate.error_state"
                initial={{ opacity: 0, y: -8 }}
                animate={{ opacity: 1, y: 0 }}
                className="flex items-center gap-2 text-destructive text-sm bg-destructive/10 border border-destructive/30 rounded-lg px-3 py-2"
              >
                <AlertCircle className="w-4 h-4 shrink-0" />
                <span>
                  Incorrect password.{" "}
                  {attemptsLeft > 0 ? (
                    <>
                      {attemptsLeft} attempt{attemptsLeft !== 1 ? "s" : ""}{" "}
                      remaining.
                    </>
                  ) : (
                    "No attempts remaining."
                  )}
                </span>
              </motion.div>
            )}

            {lockState === "locked" && (
              <motion.div
                data-ocid="gate.error_state"
                initial={{ opacity: 0, y: -8 }}
                animate={{ opacity: 1, y: 0 }}
                className="flex items-center gap-2 text-destructive text-sm bg-destructive/10 border border-destructive/30 rounded-lg px-3 py-2"
              >
                <Timer className="w-4 h-4 shrink-0" />
                <span>
                  Too many attempts. Try again in{" "}
                  <strong>{formatTime(countdown)}</strong>.
                </span>
              </motion.div>
            )}

            <button
              data-ocid="gate.submit_button"
              type="submit"
              disabled={isPending || lockState === "locked" || !password.trim()}
              className="w-full py-3 rounded-xl bg-primary text-primary-foreground font-semibold tracking-wide hover:bg-accent transition-all duration-200 disabled:opacity-40 shadow-gold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring text-sm"
            >
              {isPending ? (
                <span className="flex items-center justify-center gap-2">
                  <Loader2 className="w-4 h-4 animate-spin" />
                  Verifying...
                </span>
              ) : (
                "Unlock Access"
              )}
            </button>
          </form>

          {/* Logout link */}
          <div className="text-center pt-1">
            <button
              type="button"
              data-ocid="gate.cancel_button"
              onClick={handleLogout}
              className="text-muted-foreground hover:text-foreground text-xs transition-colors underline underline-offset-2"
            >
              Use a different account
            </button>
          </div>
        </div>
      </motion.div>
    </div>
  );
}
