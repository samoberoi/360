import { createFileRoute } from "@tanstack/react-router";
import { createClient } from "@supabase/supabase-js";
import { z } from "zod";

import type { Database } from "@/integrations/supabase/types";
import {
  getPushRegistrationStatusForUser,
  saveNativePushTokenForUser,
  sendNativePushForRecentNotifications,
  sendNativePushToCurrentUserServer,
} from "@/lib/push-delivery.server";

const VITE_SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const VITE_SUPABASE_PUBLISHABLE_KEY = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string | undefined;
const LOVABLE_NATIVE_BRIDGE_ORIGIN = "https://project--17b6aaa6-fbb3-4432-add3-c51b6957b203-dev.lovable.app";
const NATIVE_PUSH_PATH = "/api/public/native/push";

const AccessTokenSchema = z.object({ accessToken: z.string().min(20) });

const PushRequestSchema = z.discriminatedUnion("action", [
  AccessTokenSchema.extend({ action: z.literal("status") }),
  z.object({
    action: z.literal("register"),
    accessToken: z.string().min(20),
    token: z.string().min(32).max(512),
    platform: z.enum(["ios", "android", "web"]).default("ios"),
  }),
  z.object({
    action: z.literal("test"),
    accessToken: z.string().min(20),
    message: z.string().max(300).optional(),
  }),
  z.object({
    action: z.literal("sendRecent"),
    accessToken: z.string().min(20),
    userIds: z.array(z.string().uuid()).min(1).max(100),
    title: z.string().min(1).max(180),
    message: z.string().min(1).max(3000),
    link: z.string().max(500).optional(),
    notificationIds: z.array(z.string().uuid()).max(100).default([]),
  }),
]);

function isAllowedOrigin(origin: string) {
  try {
    const url = new URL(origin);
    if (url.hostname === "radiant.hyperrevamp.com") return true;
    if (url.hostname === "radiant-guard-services.lovable.app") return true;
    if (url.hostname.endsWith(".lovable.app")) return true;
    if (url.hostname.endsWith(".vercel.app")) return true;
    if (url.hostname === "localhost" || url.hostname === "127.0.0.1") return true;
  } catch {
    return false;
  }
  return false;
}

function corsHeaders(request: Request) {
  const origin = request.headers.get("origin") ?? "";
  const headers = new Headers({
    "access-control-allow-methods": "POST, OPTIONS",
    "access-control-allow-headers": "authorization, content-type",
    "access-control-max-age": "86400",
    "vary": "Origin",
  });
  if (origin && isAllowedOrigin(origin)) {
    headers.set("access-control-allow-origin", origin);
  }
  return headers;
}

function jsonResponse(request: Request, body: unknown, status = 200) {
  const headers = corsHeaders(request);
  headers.set("content-type", "application/json; charset=utf-8");
  return new Response(JSON.stringify(body), { status, headers });
}

function shouldProxyToLovableBridge(request: Request) {
  try {
    const url = new URL(request.url);
    return url.hostname !== new URL(LOVABLE_NATIVE_BRIDGE_ORIGIN).hostname;
  } catch {
    return false;
  }
}

async function proxyToLovableBridge(request: Request, rawBody: string) {
  const upstream = await fetch(`${LOVABLE_NATIVE_BRIDGE_ORIGIN}${NATIVE_PUSH_PATH}`, {
    method: "POST",
    headers: { "content-type": "text/plain;charset=UTF-8" },
    body: rawBody,
  });

  const text = await upstream.text();
  const headers = corsHeaders(request);
  headers.set("content-type", upstream.headers.get("content-type") || "application/json; charset=utf-8");
  return new Response(text, { status: upstream.status, headers });
}

function getBackendConfig() {
  const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || VITE_SUPABASE_URL;
  const publishableKey =
    process.env.SUPABASE_PUBLISHABLE_KEY ||
    process.env.VITE_SUPABASE_PUBLISHABLE_KEY ||
    VITE_SUPABASE_PUBLISHABLE_KEY;

  if (!url || !publishableKey) {
    throw new Error("Native push auth is not configured for this deployment.");
  }

  return { url, publishableKey };
}

async function authenticate(token: string) {
  if (!token) throw new Response("Unauthorized", { status: 401 });

  const { url, publishableKey } = getBackendConfig();
  const supabase = createClient<Database>(url, publishableKey, {
    global: {
      headers: { Authorization: `Bearer ${token}` },
      fetch: (input, init) => {
        const headers = new Headers(init?.headers);
        if (publishableKey.startsWith("sb_") && headers.get("Authorization") === `Bearer ${publishableKey}`) {
          headers.delete("Authorization");
        }
        headers.set("apikey", publishableKey);
        headers.set("Authorization", `Bearer ${token}`);
        return fetch(input, { ...init, headers });
      },
    },
    auth: {
      storage: undefined,
      persistSession: false,
      autoRefreshToken: false,
    },
  });

  const { data, error } = await supabase.auth.getClaims(token);
  if (error || !data?.claims?.sub) {
    throw new Response("Unauthorized", { status: 401 });
  }

  return { supabase, userId: data.claims.sub };
}

export const Route = createFileRoute("/api/public/native/push")({
  server: {
    handlers: {
      OPTIONS: async ({ request }) => new Response(null, { status: 204, headers: corsHeaders(request) }),
      POST: async ({ request }) => {
        try {
          const rawBody = await request.text();
          if (shouldProxyToLovableBridge(request)) {
            return proxyToLovableBridge(request, rawBody);
          }

          const input = PushRequestSchema.parse(JSON.parse(rawBody));
          const { supabase, userId } = await authenticate(input.accessToken);

          if (input.action === "status") {
            const status = await getPushRegistrationStatusForUser(supabase, userId);
            return jsonResponse(request, status);
          }

          if (input.action === "register") {
            const result = await saveNativePushTokenForUser(supabase, userId, {
              token: input.token,
              platform: input.platform,
            });
            return jsonResponse(request, result);
          }

          if (input.action === "test") {
            const result = await sendNativePushToCurrentUserServer(supabase, {
              title: "Radiant Guard",
              body: input.message || "Test push notification",
            });
            const firstFailure = result.failures[0]?.error;
            return jsonResponse(request, {
              ...result,
              message:
                result.sent > 0
                  ? `Sent ${result.sent} of ${result.total} push notification${result.total === 1 ? "" : "s"}.`
                  : result.total === 0
                    ? "No registered iPhone token found for this signed-in user. Tap Refresh iPhone registration and try again."
                    : firstFailure
                      ? `APNs error: ${firstFailure}`
                      : "No push notifications were sent.",
            });
          }

          const result = await sendNativePushForRecentNotifications(supabase, input.userIds, {
            title: input.title,
            body: input.message,
            link: input.link,
          }, { actorUserId: userId, notificationIds: input.notificationIds });
          return jsonResponse(request, result);
        } catch (error) {
          if (error instanceof Response) {
            return jsonResponse(request, { error: await error.text() }, error.status);
          }
          const message = error instanceof Error ? error.message : String(error);
          return jsonResponse(request, { error: message }, 400);
        }
      },
    },
  },
});