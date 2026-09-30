import { Link } from "@tanstack/react-router";
import { Cake, Gift, PartyPopper, ShieldAlert } from "lucide-react";
import type {
  BirthdayEntry,
  AnniversaryEntry,
  SixtyPlusEntry,
} from "@/lib/people-insights";

type Variant =
  | { kind: "birthdays"; items: BirthdayEntry[] }
  | { kind: "anniversaries"; items: AnniversaryEntry[] }
  | { kind: "sixty-plus"; items: SixtyPlusEntry[] };

const MONTHS_SHORT = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];

function fmt(d: Date) {
  return `${d.getDate()} ${MONTHS_SHORT[d.getMonth()]}`;
}

function initials(name: string) {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase() ?? "")
    .join("") || "?";
}

function Avatar({ src, name }: { src: string | null; name: string }) {
  if (src) {
    return (
      <img
        src={src}
        alt=""
        className="aspect-square h-8 w-8 shrink-0 rounded-full object-cover object-center ring-1 ring-border"
        loading="lazy"
      />

    );
  }
  return (
    <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-accent/15 text-[10px] font-bold text-accent ring-1 ring-inset ring-accent/20">
      {initials(name)}
    </span>
  );
}

export function PeopleInsightsCard(props: Variant & { isLoading?: boolean }) {
  const { kind, isLoading } = props;
  const meta =
    kind === "birthdays"
      ? { title: "Upcoming Birthdays", subtitle: "Next 12 months", Icon: Cake, empty: "No birthdays yet — add dates of birth to employee records." }
      : kind === "anniversaries"
        ? { title: "Work Anniversaries", subtitle: "Next 12 months", Icon: PartyPopper, empty: "No anniversaries yet — needs at least one completed year." }
        : { title: "Employees 60+", subtitle: "Sorted by age", Icon: ShieldAlert, empty: "No employees aged 60 or above." };

  return (
    <section className="overflow-hidden rounded-2xl border border-border/70 bg-card/80 shadow-sm backdrop-blur-xl">
      <header className="flex items-center gap-3 border-b border-border/60 bg-card/90 px-4 py-3.5 sm:px-5">
        <span className="grid h-8 w-8 shrink-0 place-items-center rounded-xl bg-accent/15 text-accent ring-1 ring-inset ring-accent/20">
          <meta.Icon className="h-3.5 w-3.5" />
        </span>
        <div className="min-w-0 flex-1">
          <div className="text-[10px] font-bold uppercase tracking-[0.22em] text-muted-foreground">
            {meta.subtitle}
          </div>
          <div className="font-display text-[15px] font-bold text-foreground leading-tight">{meta.title}</div>
        </div>
        {props.items.length > 0 && (
          <span className="inline-flex h-5 min-w-5 shrink-0 items-center justify-center rounded-full bg-accent/15 px-1.5 text-[10px] font-bold text-accent ring-1 ring-inset ring-accent/20">
            {props.items.length}
          </span>
        )}
      </header>

      <ul className="max-h-[280px] divide-y divide-border/60 overflow-y-auto">
        {isLoading ? (
          <li className="px-4 py-6 text-center text-xs text-muted-foreground">Loading…</li>
        ) : props.items.length === 0 ? (
          <li className="px-4 py-8 text-center text-xs text-muted-foreground">{meta.empty}</li>
        ) : (
          props.items.slice(0, 25).map((item) => {
            const isToday =
              (kind !== "sixty-plus") && (item as BirthdayEntry | AnniversaryEntry).daysUntil === 0;
            const secondary =
              kind === "birthdays"
                ? `${fmt((item as BirthdayEntry).nextDate)} · turning ${(item as BirthdayEntry).turningAge}`
                : kind === "anniversaries"
                  ? `${fmt((item as AnniversaryEntry).nextDate)} · ${(item as AnniversaryEntry).years} yr${(item as AnniversaryEntry).years === 1 ? "" : "s"} with RGS`
                  : `Age ${(item as SixtyPlusEntry).age}${item.unit_name ? ` · ${item.unit_name}` : ""}`;
            const trailing =
              kind === "sixty-plus"
                ? item.mobile ?? ""
                : (item as BirthdayEntry | AnniversaryEntry).daysUntil === 0
                  ? "Today"
                  : `in ${(item as BirthdayEntry | AnniversaryEntry).daysUntil}d`;
            return (
              <li key={item.id}>
                <Link
                  to="/admin/candidates/$id/details"
                  params={{ id: item.id }}
                  className={`flex items-center gap-3 px-4 py-2.5 transition-colors hover:bg-accent/5 ${isToday ? "bg-accent/8" : ""}`}
                >
                  <Avatar src={item.photo_url} name={item.full_name} />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-1.5 truncate text-[13px] font-semibold text-foreground">
                      <span className="truncate">{item.full_name}</span>
                      {isToday && (
                        <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/15 px-1.5 py-0.5 text-[10px] font-bold text-emerald-700 ring-1 ring-inset ring-emerald-500/25 dark:text-emerald-300">
                          <Gift className="h-2.5 w-2.5" />
                          {kind === "birthdays" ? "Birthday" : "Anniversary"}
                        </span>
                      )}
                    </div>
                    <div className="truncate text-[11px] text-muted-foreground">{secondary}</div>
                    {isToday && (kind === "birthdays" || kind === "anniversaries") && (
                      <div className="mt-0.5 truncate text-[11px] font-medium text-accent">
                        {kind === "birthdays"
                          ? `🎂 Happy birthday, ${item.full_name.split(" ")[0]}!`
                          : `🎉 Congrats on ${(item as AnniversaryEntry).years} year${(item as AnniversaryEntry).years === 1 ? "" : "s"}!`}
                      </div>
                    )}
                  </div>
                  <span className={`shrink-0 text-[11px] font-semibold tabular-nums ${isToday ? "text-accent" : "text-muted-foreground"}`}>
                    {trailing}
                  </span>
                </Link>
              </li>
            );
          })
        )}
      </ul>
    </section>
  );
}
