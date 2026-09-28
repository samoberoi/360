import { useCallback, useEffect, useRef, useState } from "react";
import { Camera, Loader2, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { supabase } from "@/integrations/supabase/client";
import { istStamp, registerSelfieHost, reverseAddress, stampFrame, type SelfieRequest } from "@/lib/selfie";

type Pending = { req: SelfieRequest; resolve: (v: string | null) => void };

const nameCache = new Map<string, { name: string; code: string }>();

async function whoIs(candidateId: string) {
  if (nameCache.has(candidateId)) return nameCache.get(candidateId)!;
  const { data } = await supabase
    .from("candidates")
    .select("full_name, employee_code, candidate_code")
    .eq("id", candidateId)
    .maybeSingle();
  const row = data as { full_name?: string; employee_code?: string; candidate_code?: string } | null;
  const v = { name: row?.full_name ?? "", code: row?.employee_code || row?.candidate_code || "" };
  nameCache.set(candidateId, v);
  return v;
}

/** Mounted once in the admin layout; serves every requestSelfie() call. */
export function SelfieCaptureHost() {
  const [pending, setPending] = useState<Pending | null>(null);
  const [lines, setLines] = useState<string[]>([]);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [shot, setShot] = useState<string | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);

  useEffect(() => {
    registerSelfieHost((p) => setPending(p));
    return () => registerSelfieHost(null);
  }, []);

  const stop = useCallback(() => {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    setReady(false);
  }, []);

  // Build stamp lines
  useEffect(() => {
    if (!pending) return;
    let cancelled = false;
    const { req } = pending;
    const base = (who: { name: string; code: string }, addr: string | null) => [
      [req.label, who.name, who.code].filter(Boolean).join(" · "),
      ...(req.site ? [req.site] : []),
      addr ?? "Locating address…",
      `Lat ${req.geo.lat.toFixed(6)}  Long ${req.geo.lng.toFixed(6)}  ±${Math.round(req.geo.accuracy)}m`,
    ];
    setLines(base({ name: "", code: "" }, null));
    void (async () => {
      const [who, addr] = await Promise.all([whoIs(req.candidateId), reverseAddress(req.geo.lat, req.geo.lng)]);
      if (!cancelled) setLines(base(who, addr ?? "Address unavailable"));
    })();
    return () => { cancelled = true; };
  }, [pending]);

  const start = useCallback(async () => {
    setError(null);
    setShot(null);
    try {
      if (!navigator.mediaDevices?.getUserMedia) throw new Error("Camera is not available on this device.");
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: "user", width: { ideal: 960 }, height: { ideal: 1280 } },
        audio: false,
      });
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play().catch(() => undefined);
      }
      setReady(true);
    } catch (e) {
      setError(e instanceof Error && /denied|permission/i.test(e.message)
        ? "Camera permission is blocked. Allow camera access and try again."
        : e instanceof Error ? e.message : "Could not open the camera.");
    }
  }, []);

  useEffect(() => {
    if (pending) void start();
    else stop();
  }, [pending, start, stop]);

  const finish = (v: string | null) => {
    pending?.resolve(v);
    stop();
    setShot(null);
    setPending(null);
  };

  const take = () => {
    const video = videoRef.current;
    if (!video || !video.videoWidth) return;
    setShot(stampFrame(video, [...lines, istStamp()]));
    stop();
  };

  return (
    <Dialog open={!!pending} onOpenChange={(o) => !o && finish(null)}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Face photo · {pending?.req.label}</DialogTitle>
          <DialogDescription>Look at the camera with your face clearly visible.</DialogDescription>
        </DialogHeader>
        <div className="relative overflow-hidden rounded-2xl bg-muted" style={{ aspectRatio: "3 / 4" }}>
          {shot ? (
            <img src={shot} alt="Selfie preview" className="h-full w-full object-cover" />
          ) : (
            <>
              <video ref={videoRef} playsInline muted className="h-full w-full object-cover" />
              {!ready && !error && (
                <div className="absolute inset-0 flex items-center justify-center">
                  <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
                </div>
              )}
              {ready && (
                <div className="pointer-events-none absolute left-1/2 top-[40%] h-[52%] w-[62%] -translate-x-1/2 -translate-y-1/2 rounded-[50%] border-2 border-dashed border-primary/80" />
              )}
              {error && (
                <div className="absolute inset-0 flex items-center justify-center p-6 text-center text-sm font-medium text-destructive">
                  {error}
                </div>
              )}
            </>
          )}
        </div>
        <div className="flex gap-2">
          {shot ? (
            <>
              <Button variant="outline" className="flex-1" onClick={() => void start()}>
                <RefreshCw className="mr-1.5 h-4 w-4" /> Retake
              </Button>
              <Button className="flex-1" onClick={() => finish(shot)}>Use photo</Button>
            </>
          ) : error ? (
            <Button className="flex-1" onClick={() => void start()}>Try again</Button>
          ) : (
            <Button className="flex-1" disabled={!ready} onClick={take}>
              <Camera className="mr-1.5 h-4 w-4" /> Take photo
            </Button>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
