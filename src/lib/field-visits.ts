import { supabase } from "@/integrations/supabase/client";
import { distanceMeters } from "@/lib/self-attendance";

export type FieldVisit = {
  id: string;
  candidate_id: string;
  unit_id: string;
  visit_date: string;
  visit_seq: number;
  check_in_at: string;
  check_in_lat: number | null;
  check_in_lng: number | null;
  check_in_accuracy: number | null;
  check_out_at: string | null;
  check_out_lat: number | null;
  check_out_lng: number | null;
  visit_notes: string | null;
  customer_rating: number | null;
  client_signature_url: string | null;
  client_photo_url: string | null;
  client_name: string | null;
  distance_from_prev_m: number | null;
  check_in_selfie_path?: string | null;
  created_at: string;
  updated_at: string;
};

export type FieldTrackPoint = {
  id: string;
  candidate_id: string;
  track_date: string;
  lat: number;
  lng: number;
  accuracy: number | null;
  recorded_at: string;
  visit_id: string | null;
};

function today(): string {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

function firstOfMonth(): string {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-01`;
}

// ----------------- Date range presets -----------------
export type RangePreset =
  | "today"
  | "yesterday"
  | "this_week"
  | "this_month"
  | "last_month"
  | "last_quarter"
  | "custom";

export const RANGE_PRESETS: { value: RangePreset; label: string }[] = [
  { value: "today", label: "Today" },
  { value: "yesterday", label: "Yesterday" },
  { value: "this_week", label: "This week" },
  { value: "this_month", label: "This month" },
  { value: "last_month", label: "Last month" },
  { value: "last_quarter", label: "Last quarter" },
  { value: "custom", label: "Custom range" },
];

export function resolveRange(
  preset: RangePreset,
  customStart?: string | null,
  customEnd?: string | null,
): { start: string; end: string; label: string; preset: RangePreset } {
  const now = new Date();
  const p = (n: number) => String(n).padStart(2, "0");
  const iso = (d: Date) => `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
  const td = iso(now);
  switch (preset) {
    case "today":
      return { start: td, end: td, label: "Today", preset };
    case "yesterday": {
      const y = new Date(now);
      y.setDate(y.getDate() - 1);
      return { start: iso(y), end: iso(y), label: "Yesterday", preset };
    }
    case "this_week": {
      const d = new Date(now);
      const dow = (d.getDay() + 6) % 7;
      d.setDate(d.getDate() - dow);
      return { start: iso(d), end: td, label: "This week", preset };
    }
    case "this_month": {
      const s = new Date(now.getFullYear(), now.getMonth(), 1);
      return { start: iso(s), end: td, label: "This month", preset };
    }
    case "last_month": {
      const s = new Date(now.getFullYear(), now.getMonth() - 1, 1);
      const e = new Date(now.getFullYear(), now.getMonth(), 0);
      return { start: iso(s), end: iso(e), label: "Last month", preset };
    }
    case "last_quarter": {
      const q = Math.floor(now.getMonth() / 3);
      const startMonth = q === 0 ? 9 : (q - 1) * 3;
      const year = q === 0 ? now.getFullYear() - 1 : now.getFullYear();
      const s = new Date(year, startMonth, 1);
      const e = new Date(year, startMonth + 3, 0);
      return { start: iso(s), end: iso(e), label: "Last quarter", preset };
    }
    case "custom":
      return {
        start: customStart || td,
        end: customEnd || td,
        label: "Custom range",
        preset,
      };
  }
}

export async function fetchVisitsInRange(
  candidateId: string,
  start: string,
  end: string,
): Promise<FieldVisit[]> {
  const { data, error } = await supabase
    .from("field_visits" as never)
    .select("*")
    .eq("candidate_id", candidateId)
    .gte("visit_date", start)
    .lte("visit_date", end)
    .order("visit_date", { ascending: false })
    .order("visit_seq", { ascending: false });
  if (error) throw error;
  return (data ?? []) as unknown as FieldVisit[];
}

export async function fetchTodayVisits(
  candidateId: string,
  date?: string,
): Promise<FieldVisit[]> {
  const { data, error } = await supabase
    .from("field_visits" as never)
    .select("*")
    .eq("candidate_id", candidateId)
    .eq("visit_date", date ?? today())
    .order("visit_seq", { ascending: true });
  if (error) throw error;
  return (data ?? []) as unknown as FieldVisit[];
}

export async function fetchMonthVisitCounts(
  candidateId: string,
): Promise<Map<string, number>> {
  const { data, error } = await supabase
    .from("field_visits" as never)
    .select("unit_id")
    .eq("candidate_id", candidateId)
    .gte("visit_date", firstOfMonth())
    .not("check_out_at", "is", null);
  if (error) throw error;
  const map = new Map<string, number>();
  for (const r of (data ?? []) as unknown as Array<{ unit_id: string }>) {
    map.set(r.unit_id, (map.get(r.unit_id) ?? 0) + 1);
  }
  return map;
}

export async function fetchLastVisitPerUnit(
  candidateId: string,
): Promise<Map<string, string>> {
  const { data, error } = await supabase
    .from("field_visits" as never)
    .select("unit_id, check_out_at, check_in_at")
    .eq("candidate_id", candidateId)
    .not("check_out_at", "is", null)
    .order("check_out_at", { ascending: false })
    .limit(500);
  if (error) throw error;
  const map = new Map<string, string>();
  for (const r of (data ?? []) as unknown as Array<{
    unit_id: string;
    check_out_at: string;
  }>) {
    if (!map.has(r.unit_id)) map.set(r.unit_id, r.check_out_at);
  }
  return map;
}

export async function fetchTodayTrackPoints(
  candidateId: string,
  date?: string,
): Promise<FieldTrackPoint[]> {
  const { data, error } = await supabase
    .from("field_track_points" as never)
    .select("*")
    .eq("candidate_id", candidateId)
    .eq("track_date", date ?? today())
    .order("recorded_at", { ascending: true });
  if (error) throw error;
  return (data ?? []) as unknown as FieldTrackPoint[];
}

export async function insertTrackPoint(params: {
  candidateId: string;
  lat: number;
  lng: number;
  accuracy: number | null;
  visitId: string | null;
}): Promise<void> {
  const { error } = await supabase.from("field_track_points" as never).insert({
    candidate_id: params.candidateId,
    track_date: today(),
    lat: params.lat,
    lng: params.lng,
    accuracy: params.accuracy,
    visit_id: params.visitId,
  } as never);
  if (error) throw error;
}

/** Create a new visit row (check-in). Returns the created id. */
export async function createVisit(params: {
  candidateId: string;
  unitId: string;
  lat: number;
  lng: number;
  accuracy: number;
  visitSeq: number;
  prevLat: number | null;
  prevLng: number | null;
  selfiePath?: string | null;
}): Promise<FieldVisit> {
  const distFromPrev =
    params.prevLat != null && params.prevLng != null
      ? distanceMeters({ lat: params.prevLat, lng: params.prevLng }, { lat: params.lat, lng: params.lng })
      : null;
  const { data, error } = await supabase
    .from("field_visits" as never)
    .insert({
      candidate_id: params.candidateId,
      unit_id: params.unitId,
      visit_date: today(),
      visit_seq: params.visitSeq,
      check_in_at: new Date().toISOString(),
      check_in_lat: params.lat,
      check_in_lng: params.lng,
      check_in_accuracy: params.accuracy,
      distance_from_prev_m: distFromPrev,
      check_in_selfie_path: params.selfiePath ?? null,
    } as never)
    .select("*")
    .single();
  if (error) throw error;
  return data as unknown as FieldVisit;
}

/** Complete a visit (checkout). All 4 required fields must be present. */
export async function completeVisit(params: {
  id: string;
  lat: number;
  lng: number;
  visitNotes: string;
  customerRating: number;
  clientSignatureUrl: string;
  clientPhotoUrl: string;
  clientName?: string | null;
}): Promise<FieldVisit> {
  const { data, error } = await supabase
    .from("field_visits" as never)
    .update({
      check_out_at: new Date().toISOString(),
      check_out_lat: params.lat,
      check_out_lng: params.lng,
      visit_notes: params.visitNotes,
      customer_rating: params.customerRating,
      client_signature_url: params.clientSignatureUrl,
      client_photo_url: params.clientPhotoUrl,
      client_name: params.clientName ?? null,
    } as never)
    .eq("id", params.id)
    .select("*")
    .single();
  if (error) throw error;
  return data as unknown as FieldVisit;
}

/** Upload a data URL (PNG/JPEG) to field-visit-proofs bucket. Returns storage path. */
export async function uploadVisitProof(params: {
  candidateId: string;
  visitId: string;
  kind: "signature" | "client";
  dataUrl: string;
}): Promise<string> {
  const ext = params.kind === "signature" ? "png" : "jpg";
  const contentType = params.kind === "signature" ? "image/png" : "image/jpeg";
  const path = `${params.candidateId}/${params.visitId}/${params.kind}.${ext}`;
  // Convert data URL to Blob
  const res = await fetch(params.dataUrl);
  const blob = await res.blob();
  const { error } = await supabase.storage
    .from("field-visit-proofs")
    .upload(path, blob, { contentType, upsert: true });
  if (error) throw error;
  return path;
}

/** Get a signed URL for a storage path (600s). */
export async function signedProofUrl(path: string | null): Promise<string | null> {
  if (!path) return null;
  const { data, error } = await supabase.storage
    .from("field-visit-proofs")
    .createSignedUrl(path, 600);
  if (error) return null;
  return data?.signedUrl ?? null;
}

/** Given the FO's current position and a list of units with lat/lng, return the nearest within maxMeters. */
export function findNearestUnit<T extends { latitude: number | null; longitude: number | null; unit_id: string }>(
  units: T[],
  pos: { lat: number; lng: number },
  maxMeters = 500,
): { unit: T; distance: number } | null {
  let best: { unit: T; distance: number } | null = null;
  for (const u of units) {
    if (u.latitude == null || u.longitude == null) continue;
    const d = distanceMeters(pos, { lat: Number(u.latitude), lng: Number(u.longitude) });
    if (d == null) continue;
    if (!best || d < best.distance) best = { unit: u, distance: d };
  }
  if (!best) return null;
  if (best.distance > maxMeters) return best; // caller decides
  return best;
}
