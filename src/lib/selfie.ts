import { supabase } from "@/integrations/supabase/client";
import type { Geo } from "@/lib/self-attendance";

export type SelfieRequest = {
  /** e.g. "Log in", "Log out", "Site visit" */
  label: string;
  candidateId: string;
  geo: Geo;
  /** Optional extra line such as the site name. */
  site?: string | null;
};

type Pending = { req: SelfieRequest; resolve: (dataUrl: string | null) => void };
type Listener = (p: Pending | null) => void;

let listener: Listener | null = null;

/** Registered by the single <SelfieCaptureHost /> mounted in the admin layout. */
export function registerSelfieHost(fn: Listener | null) {
  listener = fn;
}

/**
 * Open the front camera, let the person take a face photo, and return a JPEG
 * data URL stamped with the action, name, code, address, GPS and time.
 * Resolves null when cancelled.
 */
export function requestSelfie(req: SelfieRequest): Promise<string | null> {
  return new Promise((resolve) => {
    if (!listener) {
      resolve(null);
      throw new Error("Camera is not ready. Reload the app and try again.");
    }
    listener({ req, resolve });
  });
}

const addrCache = new Map<string, string>();
export async function reverseAddress(lat: number, lng: number): Promise<string | null> {
  const key = `${lat.toFixed(4)},${lng.toFixed(4)}`;
  if (addrCache.has(key)) return addrCache.get(key)!;
  try {
    const res = await fetch(
      `https://nominatim.openstreetmap.org/reverse?format=jsonv2&lat=${lat}&lon=${lng}&zoom=16&addressdetails=1`,
      { headers: { "Accept-Language": "en" } },
    );
    if (!res.ok) return null;
    const j = (await res.json()) as { display_name?: string };
    const parts = (j.display_name ?? "").split(",").map((s) => s.trim()).filter((s) => s && !/^\d{6}$/.test(s) && s !== "India");
    const label = parts.slice(0, 5).join(", ");
    if (label) addrCache.set(key, label);
    return label || null;
  } catch {
    return null;
  }
}

export function istStamp(d = new Date()): string {
  return (
    d.toLocaleString("en-IN", {
      timeZone: "Asia/Kolkata",
      day: "numeric",
      month: "short",
      year: "numeric",
      hour: "numeric",
      minute: "2-digit",
      second: "2-digit",
      hour12: true,
    }) + " IST"
  );
}

/** Draw a mirrored-free frame plus the dark info band, return JPEG data URL. */
export function stampFrame(
  source: CanvasImageSource & { videoWidth?: number; videoHeight?: number; width?: number; height?: number },
  lines: string[],
): string {
  const sw = (source.videoWidth || source.width || 720) as number;
  const sh = (source.videoHeight || source.height || 960) as number;
  const W = Math.min(900, sw);
  const H = Math.round((sh / sw) * W);
  const canvas = document.createElement("canvas");
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext("2d")!;
  ctx.drawImage(source, 0, 0, W, H);
  const fs = Math.max(14, Math.round(W / 38));
  const lh = Math.round(fs * 1.35);
  const pad = Math.round(fs * 0.8);
  const band = lines.length * lh + pad * 2;
  ctx.fillStyle = "rgba(20,24,32,0.72)";
  ctx.fillRect(0, H - band, W, band);
  ctx.fillStyle = "#fff";
  ctx.textBaseline = "top";
  lines.forEach((line, i) => {
    ctx.font = `${i === 0 ? "600 " : ""}${fs}px system-ui, -apple-system, sans-serif`;
    let text = line;
    while (ctx.measureText(text).width > W - pad * 2 && text.length > 4) text = text.slice(0, -2);
    if (text !== line) text = `${text}…`;
    ctx.fillText(text, pad, H - band + pad + i * lh);
  });
  return canvas.toDataURL("image/jpeg", 0.82);
}

/** Upload a stamped selfie to the private proofs bucket; returns the storage path. */
export async function uploadSelfie(candidateId: string, kind: string, dataUrl: string): Promise<string> {
  const blob = await (await fetch(dataUrl)).blob();
  const path = `${candidateId}/selfies/${new Date().toISOString().slice(0, 10)}/${kind}-${Date.now()}.jpg`;
  const { error } = await supabase.storage
    .from("field-visit-proofs")
    .upload(path, blob, { contentType: "image/jpeg", upsert: false });
  if (error) throw new Error(`Selfie upload failed: ${error.message}`);
  return path;
}

export async function signedSelfieUrl(path: string | null | undefined): Promise<string | null> {
  if (!path) return null;
  const { data } = await supabase.storage.from("field-visit-proofs").createSignedUrl(path, 600);
  return data?.signedUrl ?? null;
}

/** Take a face selfie and upload it. Throws when cancelled — every punch needs one. */
export async function captureAndUploadSelfie(req: SelfieRequest, kind: string): Promise<string> {
  const dataUrl = await requestSelfie(req);
  if (!dataUrl) throw new Error("A face photo is required. Take your selfie to continue.");
  return uploadSelfie(req.candidateId, kind, dataUrl);
}
