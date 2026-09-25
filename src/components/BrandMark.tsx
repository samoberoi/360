import logo from "@/assets/plus-360-fahrenheit-logo.png";

type BrandMarkProps = {
  className?: string;
  compact?: boolean;
  variant?: "default" | "inverse";
};

export function BrandMark({
  className = "",
  compact = false,
  variant = "default",
}: BrandMarkProps) {
  const titleClass =
    variant === "inverse" ? "text-primary-foreground" : "text-foreground";
  const subtitleClass =
    variant === "inverse"
      ? "text-primary-foreground/70"
      : "text-muted-foreground";

  return (
    <div className={`flex min-w-0 items-center gap-3 ${className}`}>
      <img
        src={logo}
        alt="PLUS 360 FAHRENHEIT SOLUTIONS PVT. LTD."
        className={compact ? "h-9 w-12 shrink-0 object-contain" : "h-10 w-[6.5rem] shrink-0 object-contain"}
      />
      {!compact && (
        <div className="min-w-0 leading-tight">
          <div className={`font-display text-sm font-medium ${titleClass}`}>
            PLUS 360 FAHRENHEIT
          </div>
          <div
            className={`mt-0.5 text-[9px] font-medium uppercase ${subtitleClass}`}
          >
            Solutions Pvt. Ltd.
          </div>
        </div>
      )}
    </div>
  );
}
