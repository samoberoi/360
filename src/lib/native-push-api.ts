import { supabase } from "@/integrations/supabase/client";
import { logNativeEvent } from "./native";

const LOVABLE_NATIVE_API_ORIGIN = "https://project--17b6aaa6-fbb3-4432-add3-c51b6957b203-dev.lovable.app";
const NATIVE_PUSH_API_PATH = "/api/public/native/push";

export type NativePushRegistrationStatus = {
  registered: boolean;
  count: number;
  latestSeenAt: string | null;
  platforms: string[];
};

export type NativePushRegistrationResult = {
  saved: boolean;
  tokenSuffix: string;
  tokenCount: number;
};

export type NativePushDeliveryResult = {
  sent: number;
  total: number;
  failures: Array<{ tokenSuffix: string; error: string }>;
  message?: string;
};

type RecentNativePushInput = {
  title: string;
  message: string;
  link?: string;
  notificationIds?: string[];
};

function nativePushApiUrls() {
  const urls: string[] = [];
  if (typeof window !== "undefined") {
    // First try the app's own host. On Vercel this route proxies to Lovable
    // Cloud server-side, avoiding iOS WebView cross-origin "Load Failed" errors.
    urls.push(`${window.location.origin}${NATIVE_PUSH_API_PATH}`);
  }
  urls.push(`${LOVABLE_NATIVE_API_ORIGIN}${NATIVE_PUSH_API_PATH}`);
  return Array.from(new Set(urls));
}

async function accessToken() {
  const {
    data: { session },
  } = await supabase.auth.getSession();

  if (!session?.access_token) {
    throw new Error("Sign in first, then try Apple push again.");
  }

  return session.access_token;
}

async function callNativePushApi<T>(payload: Record<string, unknown>): Promise<T> {
  const bodyText = JSON.stringify({ ...payload, accessToken: await accessToken() });
  let lastError: Error | null = null;

  for (const url of nativePushApiUrls()) {
    try {
      logNativeEvent("push", "calling native push bridge", { url });
      const response = await fetch(url, {
        method: "POST",
        headers: {
          "content-type": "text/plain;charset=UTF-8",
        },
        body: bodyText,
        // keepalive lets a fire-and-forget push survive a page navigation
        // triggered right after the notification insert (e.g. a redirect
        // after "submit"). Without it the iOS WebView / browser cancels
        // the request mid-flight and no banner is ever dispatched.
        keepalive: true,
      });

      const text = await response.text();
      let body: unknown = {};
      try {
        body = text ? JSON.parse(text) : {};
      } catch {
        body = { error: text || `Apple push API returned ${response.status}` };
      }

      const errorBody = body as { error?: string; message?: string };
      if (!response.ok) {
        lastError = new Error(errorBody.error || errorBody.message || `Apple push API failed (${response.status}).`);
        logNativeEvent("push", "native push bridge rejected request", {
          url,
          status: response.status,
          error: lastError.message,
        });
        if (response.status !== 404 && response.status < 500) throw lastError;
        continue;
      }

      logNativeEvent("push", "native push bridge succeeded", { url });
      return body as T;
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err));
      logNativeEvent("push", "native push bridge failed to load", {
        url,
        error: lastError.message,
      });
    }
  }

  throw new Error(lastError?.message || "Apple push bridge could not be reached.");
}

export function getNativePushRegistrationStatus() {
  return callNativePushApi<NativePushRegistrationStatus>({ action: "status" });
}

export function saveMyPushTokenViaApi(input: { token: string; platform: "ios" | "android" | "web" }) {
  return callNativePushApi<NativePushRegistrationResult>({
    action: "register",
    token: input.token,
    platform: input.platform,
  });
}

export function sendNativeTestPush(message?: string) {
  return callNativePushApi<NativePushDeliveryResult>({ action: "test", message });
}

export function sendRecentNativePush(
  userIds: string[],
  input: RecentNativePushInput,
) {
  return callNativePushApi<NativePushDeliveryResult>({
    action: "sendRecent",
    userIds,
    title: input.title,
    message: input.message,
    link: input.link ?? "",
    notificationIds: input.notificationIds ?? [],
  });
}

export async function queueRecentNativePush(
  userIds: string[],
  input: RecentNativePushInput,
) {
  await callNativePushApi<NativePushDeliveryResult>({
    action: "sendRecent",
    userIds,
    title: input.title,
    message: input.message,
    link: input.link ?? "",
    notificationIds: input.notificationIds ?? [],
  });
}