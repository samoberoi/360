import { createFileRoute } from "@tanstack/react-router";
import { ShieldCheck } from "lucide-react";

export const Route = createFileRoute("/digilocker/callback")({
  head: () => ({
    meta: [
      { title: "DigiLocker Verification Complete | PLUS 360 FAHRENHEIT SOLUTIONS" },
      {
        name: "description",
        content: "DigiLocker consent completed. Verified Aadhaar details are being sent back to the onboarding form.",
      },
      { property: "og:title", content: "DigiLocker Verification Complete" },
      {
        property: "og:description",
        content: "DigiLocker consent completed for PLUS 360 FAHRENHEIT SOLUTIONS candidate onboarding.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: DigilockerCallback,
});

function DigilockerCallback() {
  return (
    <main className="flex min-h-screen items-center justify-center bg-background px-6">
      <section className="max-w-md rounded-2xl border bg-card p-8 text-center shadow-sm">
        <ShieldCheck className="mx-auto mb-4 h-10 w-10 text-primary" />
        <h1 className="text-xl font-semibold">DigiLocker verification complete</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          You can close this window. The verified details are being pulled into the onboarding form automatically.
        </p>
      </section>
    </main>
  );
}
