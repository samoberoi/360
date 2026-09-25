import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { ArrowRight, Fingerprint, Loader2, UserRound } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  InputOTP,
  InputOTPGroup,
  InputOTPSlot,
} from "@/components/ui/input-otp";
import { useAuth } from "@/lib/auth";
import { useServerFn } from "@tanstack/react-start";
import { resendLoginOtp, sendLoginOtp, verifyLoginOtp } from "@/lib/otp.functions";
import { OTP_LENGTH } from "@/lib/otp-config";
import {
  loadMsg91Widget,
  retryWidgetOtp,
  sendWidgetOtp,
  verifyWidgetOtp,
} from "@/lib/otp-widget";
import {
  enableBiometric,
  getBiometricStatus,
  signInWithBiometric,
} from "@/lib/biometric";
import { markNativeAppSessionUnlocked } from "@/lib/native-app-lock";
import logo from "@/assets/plus-360-fahrenheit-logo.png";
import loginBg from "@/assets/login-bg.jpg";

export const Route = createFileRoute("/login")({
  head: () => ({
    meta: [
      { title: "Sign in — PLUS 360 FAHRENHEIT SOLUTIONS" },
      {
        name: "description",
        content:
          "Sign in to PLUS 360 FAHRENHEIT SOLUTIONS with your phone number and OTP.",
      },
      { property: "og:title", content: "Sign in — PLUS 360 FAHRENHEIT SOLUTIONS" },
      {
        property: "og:description",
        content:
          "Sign in to PLUS 360 FAHRENHEIT SOLUTIONS with your phone number and OTP.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
      { name: "twitter:title", content: "Sign in — PLUS 360 FAHRENHEIT SOLUTIONS" },
      {
        name: "twitter:description",
        content:
          "Sign in to PLUS 360 FAHRENHEIT SOLUTIONS with your phone number and OTP.",
      },
    ],
  }),
  component: LoginPage,
});

type Step = "phone" | "otp";

function normalizeIndianMobile(value: string) {
  let digits = value.replace(/\D/g, "");
  if (digits.length > 10 && digits.startsWith("91")) digits = digits.slice(2);
  if (digits.length > 10 && digits.startsWith("0")) digits = digits.slice(1);
  return digits.slice(-10);
}

function LoginPage() {
  const navigate = useNavigate();
  const { user, login } = useAuth();
  const requestOtp = useServerFn(sendLoginOtp);
  const requestOtpAgain = useServerFn(resendLoginOtp);
  const checkOtp = useServerFn(verifyLoginOtp);
  const verifyInFlightRef = useRef(false);

  const [step, setStep] = useState<Step>("phone");
  const [phone, setPhone] = useState("");
  const [otp, setOtp] = useState("");
  const [sending, setSending] = useState(false);
  const [verifying, setVerifying] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [resendIn, setResendIn] = useState(0);
  const [otpMode, setOtpMode] = useState<"sms" | "fixed">("sms");
  const [otpRequestId, setOtpRequestId] = useState<string | null>(null);
  const [revealing, setRevealing] = useState(false);
  const [bioAvailable, setBioAvailable] = useState(false);
  const [bioEnabled, setBioEnabled] = useState(false);
  const [bioBusy, setBioBusy] = useState(false);
  const [splashDone, setSplashDone] = useState(false);
  const [splashGone, setSplashGone] = useState(false);

  useEffect(() => {
    const t1 = setTimeout(() => setSplashDone(true), 1900);
    const t2 = setTimeout(() => setSplashGone(true), 2500);
    return () => {
      clearTimeout(t1);
      clearTimeout(t2);
    };
  }, []);

  useEffect(() => {
    if (user && !revealing) navigate({ to: "/", replace: true });
  }, [user, navigate, revealing]);

  useEffect(() => {
    void getBiometricStatus().then((status) => {
      setBioAvailable(status.available);
      setBioEnabled(status.enabled);
    });
  }, []);

  useEffect(() => {
    void loadMsg91Widget().catch(() => undefined);
  }, []);

  useEffect(() => {
    if (resendIn <= 0) return;
    const t = setTimeout(() => setResendIn((s) => s - 1), 1000);
    return () => clearTimeout(t);
  }, [resendIn]);

  const phoneValid = /^\d{10}$/.test(phone);

  async function sendOtp(e?: React.FormEvent) {
    e?.preventDefault();
    if (!phoneValid || sending) return;
    setSending(true);
    setError(null);
    try {
      const isResend = step === "otp";
      const result = isResend
        ? await requestOtpAgain({ data: { phone } })
        : await requestOtp({ data: { phone } });
      if (result.mode === "sms") {
        const requestId =
          isResend && otpRequestId
            ? (await retryWidgetOtp(otpRequestId)) ?? otpRequestId
            : await sendWidgetOtp(phone);
        setOtpRequestId(requestId);
      } else {
        setOtpRequestId(null);
      }
      setOtpMode(result.mode);
      setStep("otp");
      setResendIn(30);
      setOtp("");
      toast.success(
        result.mode === "sms"
          ? `OTP sent to +91 ••• ••• ${phone.slice(-4)}`
          : "Enter your access code to continue",
      );
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "Could not send the code. Please try again.";
      setError(message);
      toast.error(message);
    } finally {
      setSending(false);
    }
  }

  async function handleVerify(value?: string) {
    const code = value ?? otp;
    if (code.length !== OTP_LENGTH || verifyInFlightRef.current) return;
    verifyInFlightRef.current = true;
    setVerifying(true);
    try {
      // Staff can always sign in with the last four digits of their own mobile,
      // so skip the SMS widget check for that code.
      const isSelfCode = code === phone.slice(-4);
      const accessToken =
        otpMode === "sms" && !isSelfCode ? await verifyWidgetOtp(code, otpRequestId) : undefined;
      await checkOtp({ data: { phone, otp: code, accessToken } });
      await login(`+91${phone}`);
      markNativeAppSessionUnlocked();
      toast.success("Signed in");
      // Offer to enable Face ID on first successful sign-in on a device.
      const biometricStatus = await getBiometricStatus();
      if (biometricStatus.available && !biometricStatus.enabled) {
        try {
          await enableBiometric(`+91${phone}`);
          setBioAvailable(true);
          setBioEnabled(true);
          toast.success("Face ID enabled for this device");
        } catch (bioErr) {
          console.warn("[biometric] enable failed", bioErr);
          toast.info(
            bioErr instanceof Error && bioErr.message
              ? `Face ID not enabled: ${bioErr.message}`
              : "Face ID not enabled (you can enable it later from Profile).",
          );
        }
      }
      setRevealing(true);
      setTimeout(() => navigate({ to: "/", replace: true }), 640);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Could not start session. Try again.",
      );
      setOtp("");
    } finally {
      verifyInFlightRef.current = false;
      setVerifying(false);
    }
  }

  async function handleBiometricLogin() {
    if (!bioAvailable || bioBusy) return;
    setBioBusy(true);
    setError(null);
    try {
      const savedPhone = await signInWithBiometric();
      if (!savedPhone) {
        setBioBusy(false);
        return;
      }
      markNativeAppSessionUnlocked();
      await login(savedPhone);
      toast.success("Signed in with Face ID");
      setRevealing(true);
      setTimeout(() => navigate({ to: "/", replace: true }), 640);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Face ID sign-in failed. Use OTP instead.",
      );
      void getBiometricStatus().then((status) => {
        setBioAvailable(status.available);
        setBioEnabled(status.enabled);
      });
    } finally {
      setBioBusy(false);
    }
  }

  return (
    <div
      className="relative min-h-dvh w-full overflow-x-clip bg-slate-950 bg-cover bg-center bg-no-repeat text-foreground"
      style={{ backgroundImage: `url(${loginBg})` }}
    >
      {/* Splash entrance keyframes */}
      <style>{`
        @keyframes login-splash-fade {
          from { opacity: 0; transform: scale(0.92); }
          to { opacity: 1; transform: scale(1); }
        }
        @keyframes login-splash-out {
          from { opacity: 1; }
          to { opacity: 0; visibility: hidden; }
        }
        @keyframes login-panel-in {
          from { opacity: 0; transform: translateX(48px); }
          to { opacity: 1; transform: translateX(0); }
        }
        @keyframes login-brand-in {
          from { opacity: 0; transform: translateY(24px); }
          to { opacity: 1; transform: translateY(0); }
        }
        @keyframes login-loader-bar {
          from { width: 0%; }
          to { width: 100%; }
        }
      `}</style>

      {/* Splash screen */}
      {!splashGone && (
        <div
          aria-hidden={splashDone}
          className={`fixed inset-0 z-50 grid place-items-center bg-slate-950 ${
            splashDone ? "[animation:login-splash-out_0.6s_ease_forwards]" : ""
          }`}
          style={
            splashDone
              ? undefined
              : { backgroundImage: `url(${loginBg})`, backgroundSize: "cover", backgroundPosition: "center" }
          }
        >
          {!splashDone && (
            <div className="absolute inset-0 bg-slate-950/70" aria-hidden />
          )}
          <div className="relative flex flex-col items-center gap-6 [animation:login-splash-fade_0.7s_ease-out_both]">
            <div className="grid h-20 w-48 place-items-center rounded-xl bg-white px-4 shadow-2xl ring-1 ring-white/40">
              <img src={logo} alt="PLUS 360 FAHRENHEIT SOLUTIONS" className="h-14 w-full object-contain" />
            </div>
            <div className="text-center">
              <div className="font-display text-lg font-medium text-white">
                PLUS 360 FAHRENHEIT
              </div>
              <div className="mt-1 text-[10px] font-semibold uppercase tracking-[0.28em] text-white/70">
                Solutions Pvt. Ltd.
              </div>
            </div>
            <div className="h-[3px] w-44 overflow-hidden rounded-full bg-white/20">
              <div className="h-full rounded-full bg-brand [animation:login-loader-bar_1.6s_ease-in-out_forwards]" />
            </div>
          </div>
        </div>
      )}

      {/* Subtle dark scrim for text legibility */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 bg-slate-950/45"
      />

      {/* Soft brand-blue glow anchoring the left content */}
      <div
        aria-hidden
        className="pointer-events-none absolute -left-32 top-1/3 h-[480px] w-[480px] rounded-full bg-brand/25 blur-[140px]"
      />

      {/* Content wrapper — slides up on successful sign-in to reveal the CRM */}
      <div className={revealing ? "animate-slide-out-up" : ""}>
        <div className="relative z-10 flex min-h-dvh flex-col lg:flex-row">
          {/* Left — brand + tagline */}
          <div
            className="relative hidden flex-col px-6 pb-6 pt-6 sm:px-10 lg:flex lg:min-h-0 lg:flex-1 lg:px-14 lg:pb-10 lg:pt-10"
            style={{ animation: splashDone ? "login-brand-in 0.7s ease-out both" : "none", opacity: splashDone ? undefined : 0 }}
          >
            <div className="inline-flex items-center self-start rounded-[6px] bg-white px-4 py-3 shadow-md shadow-black/15">
              <img
                src={logo}
                alt="PLUS 360 FAHRENHEIT SOLUTIONS logo"
                className="h-12 w-40 shrink-0 object-contain"
              />
            </div>
            <div className="flex flex-1 items-center">
              <div className="w-full max-w-xl">
                <h1 className="font-display text-3xl font-semibold leading-[1.12] tracking-tight text-white sm:text-4xl lg:text-[44px] xl:text-[52px]">
                  Security operations,
                  <br />
                  <span className="text-white/70">managed.</span>
                </h1>
                <p className="mt-4 max-w-md text-[15px] leading-relaxed text-white/75 lg:text-base">
                  One portal for attendance, payroll, contracts and field teams
                  built for the people who keep every site running.
                </p>
                <div className="mt-8 flex flex-wrap gap-2.5">
                  {["Attendance", "Payroll", "Contracts", "Field Teams"].map((label) => (
                    <span
                      key={label}
                      className="rounded-full bg-white/10 px-4 py-1.5 text-[12px] font-semibold tracking-wide text-white/85 ring-1 ring-white/20 backdrop-blur-sm"
                    >
                      {label}
                    </span>
                  ))}
                </div>
              </div>
            </div>
          </div>

          {/* Right — login panel */}
          <div
            className="relative flex min-h-dvh w-full flex-col justify-center bg-white px-5 py-8 shadow-2xl sm:px-12 lg:w-[480px] lg:min-h-dvh lg:py-14"
            style={{ animation: splashDone ? "login-panel-in 0.7s cubic-bezier(0.22,1,0.36,1) 0.1s both" : "none", opacity: splashDone ? undefined : 0 }}
          >
            <div className="mx-auto w-full max-w-[380px]">
              <div className="flex flex-col items-center text-center">
                <img
                  src={logo}
                  alt="PLUS 360 FAHRENHEIT SOLUTIONS"
                  className="mb-5 h-14 w-44 object-contain lg:hidden"
                />
                <div className="mb-5 hidden h-20 w-20 place-items-center rounded-full bg-brand text-white shadow-lg shadow-brand/25 lg:grid">
                  <UserRound className="h-10 w-10" strokeWidth={1.75} />
                </div>
                <h2 className="font-display text-[24px] font-semibold leading-[1.1] tracking-tight text-foreground sm:text-[28px]">
                  {step === "phone" ? "Sign in" : "Verify your number"}
                </h2>
                <p className="mt-2 max-w-[300px] text-[14px] leading-relaxed text-muted-foreground">
                  {step === "phone"
                    ? "Enter your mobile number."
                    : `Code sent to +91 ••• ••• ${phone.slice(-4)}.`}
                </p>
              </div>

              <div className="mt-6 sm:mt-8">
                {step === "phone" ? (
                  <form onSubmit={sendOtp} className="space-y-5">
                    <label className="block">
                      <span className="mb-2 block text-[12px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
                        Mobile number
                      </span>
                      <div className="flex h-13 w-full items-center overflow-hidden rounded-xl border border-border bg-white transition-all focus-within:border-brand focus-within:ring-4 focus-within:ring-brand/15">
                        <div className="flex items-center gap-3 pl-4 pr-3">
                          <span className="whitespace-nowrap text-[15px] font-semibold text-foreground">
                            +91
                          </span>
                          <span className="h-6 w-px bg-border" />
                        </div>
                        <input
                           id="mobile-number"
                           name="tel-national"
                          type="tel"
                          inputMode="numeric"
                           autoComplete="tel-national"
                          placeholder="98765 43210"
                          value={phone}
                           onChange={(e) => setPhone(normalizeIndianMobile(e.target.value))}
                           className="h-13 min-w-0 flex-1 bg-transparent pr-4 text-[16px] font-medium tracking-wide text-foreground placeholder:font-normal placeholder:text-muted-foreground/35 focus:outline-none"
                        />
                      </div>
                    </label>

                    <Button
                      type="submit"
                      disabled={!phoneValid || sending}
                      className="group h-13 w-full rounded-xl bg-brand text-[15px] font-semibold text-white transition-all hover:bg-brand/90 disabled:opacity-50"
                    >
                      {sending ? (
                        <Loader2 className="h-5 w-5 animate-spin" />
                      ) : (
                        <>
                          Send OTP
                          <ArrowRight className="ml-2 h-4 w-4 transition-transform group-hover:translate-x-0.5" />
                        </>
                      )}
                    </Button>

                    {bioAvailable && bioEnabled && (
                      <button
                        type="button"
                        onClick={handleBiometricLogin}
                        disabled={bioBusy}
                        className="flex h-12 w-full items-center justify-center gap-2 rounded-xl border border-border bg-white text-[14px] font-semibold text-foreground transition hover:bg-muted disabled:opacity-60"
                      >
                        {bioBusy ? (
                          <Loader2 className="h-4 w-4 animate-spin" />
                        ) : (
                          <>
                            <Fingerprint className="h-4 w-4 text-brand" />
                            Sign in with Face ID
                          </>
                        )}
                      </button>
                    )}
                  </form>
                ) : (
                  <div className="space-y-5">
                    <div className={error ? "animate-shake" : ""}>
                      <InputOTP
                         autoComplete="one-time-code"
                         inputMode="numeric"
                        maxLength={OTP_LENGTH}
                        value={otp}
                        onChange={(v) => {
                          setOtp(v);
                          setError(null);
                          if (v.length === OTP_LENGTH) handleVerify(v);
                        }}
                        containerClassName="justify-between gap-2"
                      >
                        <InputOTPGroup className="flex w-full justify-between gap-2">
                          {Array.from({ length: OTP_LENGTH }, (_, i) => i).map((i) => (
                            <InputOTPSlot
                              key={i}
                              index={i}
                              className="h-14 w-full rounded-xl border border-border bg-white text-xl font-semibold tabular-nums text-foreground first:rounded-l-xl last:rounded-r-xl data-[active=true]:border-brand data-[active=true]:ring-4 data-[active=true]:ring-brand/15"
                            />
                          ))}
                        </InputOTPGroup>
                      </InputOTP>

                      {error ? (
                        <p className="mt-3 text-center text-sm font-medium text-destructive">
                          {error}
                        </p>
                      ) : (
                        <p className="mt-3 text-center text-[13px] text-muted-foreground">
                          Enter the {OTP_LENGTH}-digit code sent to your phone
                        </p>
                      )}
                    </div>

                    <Button
                      onClick={() => handleVerify()}
                      disabled={otp.length !== OTP_LENGTH || verifying}
                      className="h-13 w-full rounded-xl bg-brand text-[15px] font-semibold text-white hover:bg-brand/90 disabled:opacity-50"
                    >
                      {verifying ? (
                        <Loader2 className="h-5 w-5 animate-spin" />
                      ) : (
                        "Verify & sign in"
                      )}
                    </Button>

                    <div className="flex items-center justify-between text-sm">
                      <button
                        type="button"
                        onClick={() => {
                          setStep("phone");
                          setOtp("");
                          setError(null);
                        }}
                        className="font-medium text-muted-foreground hover:text-foreground"
                      >
                        ← Change number
                      </button>
                      <button
                        type="button"
                        disabled={resendIn > 0 || sending}
                        onClick={() => sendOtp()}
                        className="font-semibold text-brand hover:opacity-80 disabled:cursor-not-allowed disabled:text-muted-foreground"
                      >
                        {resendIn > 0 ? `Resend in ${resendIn}s` : "Resend OTP"}
                      </button>
                    </div>
                  </div>
                )}
              </div>

            </div>

            {/* Footer credit */}
            <div className="mt-10 text-center text-[11px] font-medium uppercase tracking-[0.16em] text-muted-foreground lg:absolute lg:inset-x-0 lg:bottom-6 lg:mt-0">
               Designed &amp; Developed by{" "}
               <a
                 href="https://hyperrevamp.com"
                 target="_blank"
                 rel="noopener noreferrer"
                 className="font-semibold text-foreground underline underline-offset-2 hover:text-brand"
               >
                 HyperRevamp
               </a>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
