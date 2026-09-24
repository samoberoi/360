import { isNativePlatform, logNativeEvent } from "@/lib/native";

export type LocationPermissionState = "granted" | "denied" | "prompt" | "unavailable";

/**
 * Browser location state without triggering a prompt. Chrome/Edge/Firefox
 * expose the Permissions API; Safari does not, so we fall back to "prompt".
 */
async function queryWebPermission(): Promise<LocationPermissionState> {
  if (typeof navigator === "undefined" || !navigator.geolocation) return "unavailable";
  try {
    const status = await navigator.permissions?.query({ name: "geolocation" as PermissionName });
    if (status?.state === "granted") return "granted";
    if (status?.state === "denied") return "denied";
    return "prompt";
  } catch {
    return "prompt";
  }
}

/**
 * Ask for foreground location access. On Android this shows the OS runtime
 * dialog (the same moment we ask for notifications); in a browser it shows the
 * browser's own location prompt.
 */
export async function requestLocationPermission(): Promise<LocationPermissionState> {
  if (!isNativePlatform()) {
    // On the web the only way to ask is to actually request a position — that
    // is what shows the browser's own "Allow location" dialog.
    const current = await queryWebPermission();
    if (current === "unavailable" || current === "granted") return current;
    return await new Promise<LocationPermissionState>((resolve) => {
      navigator.geolocation.getCurrentPosition(
        () => resolve("granted"),
        (err) => resolve(err.code === err.PERMISSION_DENIED ? "denied" : "prompt"),
        { enableHighAccuracy: true, timeout: 20_000, maximumAge: 15_000 },
      );
    });
  }
  try {
    const { Geolocation } = await import("@capacitor/geolocation");
    let status = await Geolocation.checkPermissions();
    if (status.location !== "granted") {
      status = await Geolocation.requestPermissions({ permissions: ["location"] });
    }
    logNativeEvent("location", "permission state", status);
    if (status.location === "granted") return "granted";
    if (status.location === "denied") return "denied";
    return "prompt";
  } catch (err) {
    logNativeEvent("location", "permission request failed", {
      error: err instanceof Error ? err.message : String(err),
    });
    return "unavailable";
  }
}

export async function checkLocationPermission(): Promise<LocationPermissionState> {
  if (!isNativePlatform()) return await queryWebPermission();
  try {
    const { Geolocation } = await import("@capacitor/geolocation");
    const status = await Geolocation.checkPermissions();
    if (status.location === "granted") return "granted";
    if (status.location === "denied") return "denied";
    return "prompt";
  } catch {
    return "unavailable";
  }
}

export const LOCATION_REQUIRED_MESSAGE =
  "Location (GPS) must be turned on to mark attendance. Enable location for PLUS 360 and try again.";
