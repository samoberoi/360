import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect } from "react";
import { LogOut, Sparkles } from "lucide-react";
import { BrandMark } from "@/components/BrandMark";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/lib/auth";

export const Route = createFileRoute("/welcome")({
  head: () => ({
    meta: [
      { title: "Welcome — PLUS 360 FAHRENHEIT SOLUTIONS" },
      {
        name: "description",
        content: "Your PLUS 360 FAHRENHEIT SOLUTIONS command center.",
      },
    ],
  }),
  component: WelcomePage,
});

function maskPhone(phone: string) {
  const digits = phone.replace(/\D/g, "");
  const last4 = digits.slice(-4);
  return `+91 ••• ••• ${last4}`;
}

function WelcomePage() {
  const navigate = useNavigate();
  const { user, logout, isReady } = useAuth();

  useEffect(() => {
    if (!isReady) return;
    if (!user) navigate({ to: "/login", replace: true });
  }, [user, isReady, navigate]);

  function handleLogout() {
    logout();
    navigate({ to: "/login", replace: true });
  }

  return (
    <div className="relative flex min-h-dvh items-center justify-center overflow-x-clip bg-background px-5 py-12">
      <div className="ambient-glow pointer-events-none absolute inset-0" />
      <div className="hero-glow pointer-events-none absolute inset-x-0 top-0 h-[60vh]" />
      <div className="dot-pattern pointer-events-none absolute inset-0 opacity-30" />

      <div className="relative z-10 w-full max-w-xl">
        <div className="glass glow-accent rounded-3xl p-8 text-center sm:p-12">
          <div className="flex justify-center">
            <BrandMark className="justify-center" />
          </div>

          <span className="mt-7 inline-flex items-center gap-2 rounded-full border border-accent/40 bg-accent/10 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.2em] text-accent">
            <Sparkles className="h-3 w-3" /> Signed in
          </span>

          <h1 className="mt-5 font-display text-2xl font-bold tracking-tight text-foreground sm:text-2xl">
            Welcome to <span className="text-gradient-accent">PLUS 360</span>
          </h1>

          <p className="mt-4 text-base text-muted-foreground sm:text-lg">
            You're signed in as{" "}
            <span className="font-semibold text-foreground">
              {user ? maskPhone(user.phone) : "—"}
            </span>
            . Preparing dashboard...
          </p>

          <div className="mt-9 flex flex-col items-center gap-3 sm:flex-row sm:justify-center">
            <Button
              onClick={handleLogout}
              variant="outline"
              className="h-11 rounded-xl border-border bg-background px-6 font-semibold hover:bg-background hover:border-accent hover:text-accent"
            >
              <LogOut className="mr-2 h-4 w-4" />
              Sign out
            </Button>
          </div>
        </div>

        <p className="mt-6 text-center text-xs uppercase tracking-[0.25em] text-muted-foreground">
          PLUS 360 FAHRENHEIT SOLUTIONS PVT. LTD.
        </p>
      </div>
    </div>
  );
}
