import { supabase } from "@/integrations/supabase/client";

import type {
  AttendanceOcrInput,
  AttendanceOcrResult,
  MigrationSheetInput,
  MigrationSheetResult,
} from "./sheet-ocr-types";

const LOVABLE_BRIDGE_ORIGIN = "https://project--17b6aaa6-fbb3-4432-add3-c51b6957b203-dev.lovable.app";
const SHEET_OCR_PATH = "/api/public/sheet-ocr";

function urls() {
  const list: string[] = [];
  if (typeof window !== "undefined") {
    list.push(`${window.location.origin}${SHEET_OCR_PATH}`);
  }
  list.push(`${LOVABLE_BRIDGE_ORIGIN}${SHEET_OCR_PATH}`);
  return Array.from(new Set(list));
}

async function accessToken() {
  const {
    data: { session },
  } = await supabase.auth.getSession();
  if (!session?.access_token) throw new Error("Please sign in again, then retry the upload.");
  return session.access_token;
}

async function callSheetOcr<T>(action: "migration" | "muster", payload: unknown): Promise<T> {
  const bodyText = JSON.stringify({ action, accessToken: await accessToken(), payload });
  let lastError: Error | null = null;

  for (const url of urls()) {
    try {
      const response = await fetch(url, {
        method: "POST",
        headers: { "content-type": "text/plain;charset=UTF-8" },
        body: bodyText,
      });
      const text = await response.text();
      let body: unknown = {};
      try {
        body = text ? JSON.parse(text) : {};
      } catch {
        body = { error: text.slice(0, 300) };
      }
      if (!response.ok) {
        const message =
          (body as { error?: string }).error || `Sheet reading failed (${response.status}).`;
        throw new Error(message);
      }
      return body as T;
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));
    }
  }

  throw lastError ?? new Error("Sheet reading failed.");
}

export function extractMigrationSheetViaApi(payload: MigrationSheetInput) {
  return callSheetOcr<MigrationSheetResult>("migration", payload);
}

export function extractAttendanceViaApi(payload: AttendanceOcrInput) {
  return callSheetOcr<AttendanceOcrResult>("muster", payload);
}
