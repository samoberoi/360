import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  Outlet,
  Link,
  createRootRouteWithContext,
  HeadContent,
  Scripts,
  useRouter,
} from "@tanstack/react-router";
import { useEffect } from "react";

import appCss from "../styles.css?url";
import logo from "../assets/plus-360-fahrenheit-logo.png";
import { Button } from "@/components/ui/button";
import { ConfirmProvider } from "@/components/ConfirmProvider";
import { ExportChooser } from "@/components/ExportChooser";
import { LanguageProvider } from "@/lib/i18n";
import { initNative } from "@/lib/native";
import "@/lib/purge-stale-cache";
import { supabaseSessionReady } from "@/lib/supabase-ready";
import { setPushRouter } from "@/lib/push-deeplink";

import { NativeAppLock } from "@/components/NativeAppLock";


function NotFoundComponent() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="max-w-md text-center">
        <h1 className="text-2xl font-bold text-foreground">404</h1>
        <h2 className="mt-4 text-xl font-semibold text-foreground">Page not found</h2>
        <p className="mt-2 text-sm text-muted-foreground">
          The page you're looking for doesn't exist or has been moved.
        </p>
        <div className="mt-6">
          <Link
            to="/"
            className="inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
          >
            Go home
          </Link>
        </div>
      </div>
    </div>
  );
}

function ErrorComponent({ error }: { error: Error; reset: () => void }) {
  console.error(error);

  useEffect(() => {
    const message = `${error.name}: ${error.message}`.toLowerCase();
    const isStaleBuildError =
      message.includes("chunkloaderror") ||
      message.includes("dynamically imported module") ||
      message.includes("failed to fetch module script") ||
      message.includes("importing a module script failed");
    if (!isStaleBuildError) return;

    const key = "radiant.stale-build-reload";
    const lastReload = Number(window.sessionStorage.getItem(key) ?? 0);
    if (Date.now() - lastReload < 30_000) return;
    window.sessionStorage.setItem(key, String(Date.now()));
    window.location.reload();
  }, [error]);

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="max-w-md text-center">
        <h1 className="text-xl font-semibold tracking-tight text-foreground">
          This page didn't load
        </h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Something went wrong on our end. You can try refreshing or head back home.
        </p>
        <div className="mt-6 flex flex-wrap justify-center gap-2">
          <Button
            onClick={() => {
              window.location.reload();
            }}
          >
            Try again
          </Button>
          <a
            href="/"
            className="inline-flex items-center justify-center rounded-md border border-input bg-background px-4 py-2 text-sm font-medium text-foreground transition-colors hover:bg-accent"
          >
            Go home
          </a>
        </div>
      </div>
    </div>
  );
}

export const Route = createRootRouteWithContext<{ queryClient: QueryClient }>()({
  head: () => ({
    meta: [
      { charSet: "utf-8" },
      { name: "viewport", content: "width=device-width, initial-scale=1, viewport-fit=cover, maximum-scale=1" },
      { name: "mobile-web-app-capable", content: "yes" },
      { name: "apple-mobile-web-app-capable", content: "yes" },
      { name: "apple-mobile-web-app-status-bar-style", content: "default" },
      { name: "format-detection", content: "telephone=no" },
      { name: "theme-color", content: "#ffffff" },
      { title: "PLUS 360 FAHRENHEIT SOLUTIONS" },
      { name: "description", content: "Secure portal for PLUS 360 FAHRENHEIT SOLUTIONS PVT. LTD." },
      { name: "author", content: "PLUS 360 FAHRENHEIT SOLUTIONS" },
      { property: "og:title", content: "PLUS 360 FAHRENHEIT SOLUTIONS" },
      { property: "og:description", content: "Secure portal for PLUS 360 FAHRENHEIT SOLUTIONS PVT. LTD." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
      { name: "twitter:site", content: "@HyperRevamp" },
    ],
    links: [
      { rel: "icon", type: "image/png", href: logo },
      { rel: "manifest", href: "/manifest.webmanifest" },
      { rel: "preconnect", href: "https://fonts.googleapis.com" },
      { rel: "preconnect", href: "https://fonts.gstatic.com", crossOrigin: "anonymous" },
      {
        rel: "stylesheet",
        href: "https://fonts.googleapis.com/css2?family=Manrope:wght@400;500;600;700&family=Sora:wght@500;600;700&display=swap",
      },
      {
        rel: "stylesheet",
        href: appCss,
      },
    ],
  }),
  shellComponent: RootShell,
  component: RootComponent,
  notFoundComponent: NotFoundComponent,
  errorComponent: ErrorComponent,
});

function RootShell({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        <HeadContent />
      </head>
      <body>
        {children}
        <Scripts />
      </body>
    </html>
  );
}

function RootComponent() {
  const { queryClient } = Route.useRouteContext();

  const router = useRouter();

  // Notification taps navigate in-app through the router (never a hard page
  // load), so an unknown deep link falls back to home instead of a 404 page.
  useEffect(() => {
    setPushRouter(router);
  }, [router]);

  // Initialise Capacitor plugins on native (no-op on web).
  useEffect(() => {
    void initNative();
  }, []);

  // The Supabase session hydrates asynchronously. Queries that fired before
  // the bearer token was attached come back empty (RLS returns zero rows with
  // no error) — that is the "everything shows 0 until I refresh again" bug.
  // Once the session is ready, refetch everything that loaded too early.
  useEffect(() => {
    let cancelled = false;
    void supabaseSessionReady().then((hasSession) => {
      if (cancelled || !hasSession) return;
      void queryClient.invalidateQueries();
    });
    return () => {
      cancelled = true;
    };
  }, [queryClient]);


  // Promote any [title] into [data-tip] (to suppress the slow native tooltip)
  // and render a portal-mounted floating pill on hover/focus. Using a fixed
  // portal element guarantees the pill escapes any overflow:hidden container
  // (tables, cards, scroll wrappers) — pure CSS ::after tooltips do not.
  useEffect(() => {
    if (typeof window === "undefined") return;

    const promoteEl = (el: HTMLElement) => {
      if (el.hasAttribute("title")) {
        if (el.hasAttribute("data-no-tip")) {
          el.removeAttribute("title");
        } else {
          const t = el.getAttribute("title");
          if (t) {
            el.setAttribute("data-tip", t);
            el.removeAttribute("title");
          }
        }
      }
      if (
        !el.hasAttribute("data-tip") &&
        !el.hasAttribute("data-no-tip") &&
        (el.tagName === "BUTTON" || el.tagName === "A") &&
        el.hasAttribute("aria-label") &&
        (el.textContent ?? "").trim().length === 0
      ) {
        const label = el.getAttribute("aria-label");
        if (label) el.setAttribute("data-tip", label);
      }
    };

    const promote = (root: ParentNode) => {
      if ((root as HTMLElement).nodeType === 1) promoteEl(root as HTMLElement);
      root
        .querySelectorAll<HTMLElement>("[title], button[aria-label], a[aria-label]")
        .forEach(promoteEl);
    };

    promote(document.body);
    const obs = new MutationObserver((muts) => {
      for (const m of muts) {
        m.addedNodes.forEach((n) => {
          if (n.nodeType === 1) promote(n as Element);
        });
        if (m.type === "attributes" && m.target.nodeType === 1) {
          const el = m.target as HTMLElement;
          if (el.hasAttribute("data-no-tip")) {
            el.removeAttribute("title");
            el.removeAttribute("data-tip");
            continue;
          }
          const t = el.getAttribute("title");
          if (t) {
            el.setAttribute("data-tip", t);
            el.removeAttribute("title");
          }
          // NOTE: do not remove data-tip when title disappears — our own
          // promotion removes title and would otherwise wipe the tooltip.
        }
      }
    });
    obs.observe(document.body, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ["title"],
    });

    // ---- portal pill ----------------------------------------------------
    const pill = document.createElement("div");
    pill.setAttribute("role", "tooltip");
    pill.style.cssText = [
      "position:fixed",
      "z-index:99999",
      "pointer-events:none",
      "padding:4px 8px",
      "border-radius:6px",
      "background:oklch(0.18 0.02 260)",
      "color:oklch(0.99 0 0)",
      "font-size:11px",
      "font-weight:500",
      "line-height:1.2",
      "letter-spacing:0.01em",
      "box-shadow:0 6px 18px -6px rgba(0,0,0,0.35)",
      "white-space:nowrap",
      "max-width:280px",
      "opacity:0",
      "transform:translate(-50%,4px)",
      "transition:opacity .12s ease-out, transform .12s ease-out",
      "top:-9999px",
      "left:-9999px",
    ].join(";");
    document.body.appendChild(pill);

    let current: HTMLElement | null = null;
    let showTimer: number | null = null;

    const place = (target: HTMLElement) => {
      const r = target.getBoundingClientRect();
      const label = target.getAttribute("data-tip") ?? "";
      pill.textContent = label;
      // measure
      pill.style.opacity = "0";
      pill.style.top = "0px";
      pill.style.left = "0px";
      pill.style.transform = "translate(-50%, 4px)";
      const pw = pill.offsetWidth;
      const ph = pill.offsetHeight;
      const vw = window.innerWidth;
      const vh = window.innerHeight;
      let top = r.bottom + 8;
      let placeAbove = false;
      if (top + ph > vh - 8) {
        top = r.top - ph - 8;
        placeAbove = true;
      }
      let left = r.left + r.width / 2;
      const halfW = pw / 2;
      if (left - halfW < 8) left = halfW + 8;
      if (left + halfW > vw - 8) left = vw - halfW - 8;
      pill.style.top = `${top}px`;
      pill.style.left = `${left}px`;
      pill.style.transform = placeAbove
        ? "translate(-50%, -4px)"
        : "translate(-50%, 4px)";
      requestAnimationFrame(() => {
        pill.style.opacity = "1";
        pill.style.transform = "translate(-50%, 0)";
      });
    };

    const hide = () => {
      if (!current && showTimer === null && pill.style.opacity === "0") return;
      current = null;
      if (showTimer) {
        window.clearTimeout(showTimer);
        showTimer = null;
      }
      pill.style.opacity = "0";
      pill.style.top = "-9999px";
      pill.style.left = "-9999px";
    };

    const findTip = (start: EventTarget | null): HTMLElement | null => {
      let el = start as HTMLElement | null;
      while (el && el.nodeType === 1) {
        if (el.hasAttribute?.("data-tip") && !el.hasAttribute("data-no-tip")) return el;
        el = el.parentElement;
      }
      return null;
    };

    const onOver = (e: Event) => {
      const tip = findTip(e.target);
      if (!tip || tip === current) return;
      current = tip;
      if (showTimer) window.clearTimeout(showTimer);
      showTimer = window.setTimeout(() => place(tip), 120);
    };
    const onOut = (e: Event) => {
      const tip = findTip(e.target);
      if (!tip) return;
      const next = (e as MouseEvent).relatedTarget as Node | null;
      if (next && tip.contains(next)) return;
      hide();
    };
    const onScroll = () => hide();

    document.addEventListener("mouseover", onOver, true);
    document.addEventListener("mouseout", onOut, true);
    document.addEventListener("focusin", onOver, true);
    document.addEventListener("focusout", onOut, true);
    window.addEventListener("scroll", onScroll, { capture: true, passive: true });
    window.addEventListener("resize", hide);

    return () => {
      obs.disconnect();
      document.removeEventListener("mouseover", onOver, true);
      document.removeEventListener("mouseout", onOut, true);
      document.removeEventListener("focusin", onOver, true);
      document.removeEventListener("focusout", onOut, true);
      window.removeEventListener("scroll", onScroll, true);
      window.removeEventListener("resize", hide);
      pill.remove();
    };
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return;

    const labelTables = (root: ParentNode = document) => {
      root.querySelectorAll<HTMLTableElement>("table.ios-table").forEach((table) => {
        const headers = Array.from(table.querySelectorAll<HTMLTableCellElement>("thead th")).map((th) =>
          (th.textContent ?? "").replace(/\s+/g, " ").trim(),
        );
        table.querySelectorAll<HTMLTableRowElement>("tbody tr").forEach((row) => {
          Array.from(row.children).forEach((cell, index) => {
            if (!(cell instanceof HTMLTableCellElement)) return;
            if (cell.colSpan > 1) return;
            const label = headers[index] ?? "";
            if (label) cell.setAttribute("data-label", label);
          });
        });
      });
    };

    labelTables();
    const tableObserver = new MutationObserver((mutations) => {
      for (const mutation of mutations) {
        mutation.addedNodes.forEach((node) => {
          if (node.nodeType === 1) labelTables(node as Element);
        });
        if (mutation.type === "childList" && mutation.target.nodeType === 1) {
          labelTables(mutation.target as Element);
        }
      }
    });
    tableObserver.observe(document.body, { childList: true, subtree: true });

    return () => tableObserver.disconnect();
  }, []);

  return (
    <QueryClientProvider client={queryClient}>
      <LanguageProvider>
        <ConfirmProvider>
          <Outlet />
          <NativeAppLock />
          <ExportChooser />
        </ConfirmProvider>
      </LanguageProvider>
    </QueryClientProvider>
  );
}


