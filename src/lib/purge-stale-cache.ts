// Wipes browser-saved snapshots (dashboard counts, lists, etc.) whenever the
// backend this app talks to changes, so numbers from a previous database can
// never be shown. Auth/session keys are kept only if they belong to this backend.
const MARK = "radiant.backend-ref";

if (typeof window !== "undefined") {
  try {
    const ref = String(import.meta.env.VITE_SUPABASE_PROJECT_ID ?? "");
    if (window.localStorage.getItem(MARK) !== ref) {
      const keep = (k: string) => k.startsWith(`sb-${ref}-`);
      Object.keys(window.localStorage).forEach((k) => {
        if (!keep(k)) window.localStorage.removeItem(k);
      });
      window.sessionStorage.clear();
      window.localStorage.setItem(MARK, ref);
    }
  } catch {
    /* storage unavailable */
  }
}

export {};
