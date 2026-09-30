import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useRouter } from "@tanstack/react-router";
import { Bell, CheckCheck, RotateCw, Sparkles } from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import { cn } from "@/lib/utils";
import { listMyNotifications, markAllRead, markNotificationRead, type Notification } from "@/lib/notifications";
import { shouldRedirect } from "@/lib/notification-routing";
import { NotificationDetailDialog } from "@/components/NotificationDetailDialog";
import { Button } from "@/components/ui/button";

const NQK = ["notifications", "mine"] as const;

/**
 * Right-rail "Live Feed" panel used on every dashboard.
 * The first (latest) item is rendered as a featured card — bigger, richer,
 * more scannable — while the rest collapse into a compact scroll list so the
 * panel stays lightweight and every card in the rail feels equally polished.
 */
export function LiveFeed({ className }: { className?: string }) {
  const qc = useQueryClient();
  const router = useRouter();
  const [detail, setDetail] = useState<Notification | null>(null);
  const { data: items = [], isFetching, refetch } = useQuery({
    queryKey: NQK,
    queryFn: listMyNotifications,
    refetchInterval: 15_000,
  });
  const unread = items.filter((n) => !n.readAt).length;
  const featured = items[0];
  const rest = items.slice(1, 10);

  const openLink = (target: string) => {
    if (!target) return;
    if (target.startsWith("/")) router.history.push(target);
    else if (typeof window !== "undefined") window.location.href = target;
  };

  const handleOpen = async (n: (typeof items)[number]) => {
    if (!n.readAt) {
      await markNotificationRead(n.id);
      qc.invalidateQueries({ queryKey: NQK });
    }
    if (shouldRedirect(n.type) && n.link && n.link.trim()) {
      openLink(n.link);
    } else {
      setDetail(n);
    }
  };


  return (
    <>
    <aside

      className={cn(
        "flex h-fit max-h-[460px] flex-col overflow-hidden rounded-2xl border border-border/70 bg-card/80 shadow-sm backdrop-blur-xl",
        className,
      )}
    >
      <div className="flex min-h-16 items-center justify-between border-b border-border/60 bg-card/90 px-5 py-3.5">
        <div className="min-w-0 flex items-center gap-2">
          <span className="grid h-7 w-7 shrink-0 place-items-center rounded-lg bg-accent/15 text-accent ring-1 ring-inset ring-accent/20">
            <Bell className="h-3.5 w-3.5" />
          </span>
          <div className="min-w-0">
            <div className="text-[9px] font-semibold uppercase tracking-[0.16em] text-muted-foreground leading-none">
              Live feed
            </div>
            <div className="mt-0.5 flex items-center gap-1.5">
              <h3 className="font-display text-[13px] font-bold text-foreground leading-tight">Activity</h3>
              {unread > 0 && (
                <span className="inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-destructive px-1 text-[9px] font-bold text-destructive-foreground">
                  {unread > 9 ? "9+" : unread}
                </span>
              )}
            </div>
          </div>
        </div>
        <div className="flex items-center gap-1">
          <Button
            type="button"
            variant="ghost"
            size="icon"
            onClick={() => refetch()}
            aria-label="Refresh"
            className="h-8 w-8 rounded-full border border-border/70 bg-card/80 text-muted-foreground hover:text-foreground"
          >
            <RotateCw className={cn("h-3 w-3", isFetching && "animate-spin")} />
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            disabled={unread === 0}
            onClick={async () => {
              await markAllRead();
              qc.invalidateQueries({ queryKey: NQK });
            }}
            aria-label="Mark all read"
            className="h-8 w-8 rounded-full border border-border/70 bg-card/80 text-muted-foreground hover:text-foreground disabled:opacity-40"
          >
            <CheckCheck className="h-3 w-3" />
          </Button>
        </div>
      </div>

      {!featured ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-2 px-6 py-10 text-center">
          <div className="grid h-10 w-10 place-items-center rounded-2xl bg-accent/10 text-accent">
            <Sparkles className="h-4 w-4" />
          </div>
          <div className="text-[13px] font-semibold text-foreground">You're all caught up</div>
          <div className="text-[11px] text-muted-foreground">
            New updates will appear here.
          </div>
        </div>
      ) : (
        <>
          {/* Featured latest notification — larger, richer */}
          <Button
            type="button"
            variant="ghost"
            onClick={() => handleOpen(featured)}
            className={cn(
              "group relative m-3 mb-2 h-auto min-h-0 w-auto items-start justify-start gap-3 whitespace-normal rounded-2xl border p-3 text-left transition-all",
              !featured.readAt
                ? "border-accent bg-accent text-accent-foreground shadow-md hover:shadow-lg"
                : "border-border/60 bg-card hover:bg-secondary/40",
            )}
          >
            <span
              className={cn(
                "grid h-10 w-10 shrink-0 place-items-center rounded-xl",
                !featured.readAt
                  ? "bg-white/25 text-accent-foreground"
                  : "bg-secondary text-muted-foreground ring-1 ring-inset ring-border",
              )}
            >
              <Bell className="h-4 w-4" />
            </span>
            <div className="min-w-0 flex-1">
              <div className="flex items-start justify-between gap-2">
                <div className={cn(
                  "text-[10px] font-bold uppercase tracking-[0.18em]",
                  !featured.readAt ? "text-accent-foreground/85" : "text-accent",
                )}>
                  {featured.readAt ? "Latest" : "New"}
                </div>
                <div className={cn(
                  "shrink-0 text-[10px] font-medium",
                  !featured.readAt ? "text-accent-foreground/80" : "text-muted-foreground",
                )}>
                  {formatDistanceToNow(new Date(featured.createdAt), { addSuffix: true })}
                </div>
              </div>
              <div className={cn(
                "mt-0.5 line-clamp-2 text-[13.5px] font-bold leading-snug",
                !featured.readAt ? "text-accent-foreground" : "text-foreground",
              )}>
                {featured.title}
              </div>
              {featured.message && (
                <div className={cn(
                  "mt-1 line-clamp-2 text-[11.5px] leading-snug",
                  !featured.readAt ? "text-accent-foreground/85" : "text-muted-foreground",
                )}>
                  {featured.message}
                </div>
              )}
            </div>
          </Button>

          {/* Compact remainder */}
          {rest.length > 0 && (
            <div className="min-h-0 flex-1 overflow-y-auto px-3 pb-2">
              <div className="px-1 pb-1.5 pt-0.5 text-[9px] font-bold uppercase tracking-[0.22em] text-muted-foreground/80">
                Earlier
              </div>
              <ol className="space-y-0.5">
                {rest.map((n) => {
                  const time = formatDistanceToNow(new Date(n.createdAt), { addSuffix: true });
                  return (
                    <li key={n.id}>
                      <Button
                        type="button"
                        variant="ghost"
                        onClick={() => handleOpen(n)}
                        className={cn(
                          "group h-auto min-h-0 w-full items-center justify-start gap-2.5 whitespace-normal rounded-xl px-2 py-1.5 text-left transition-colors hover:bg-card",
                          !n.readAt && "bg-accent/[0.06]",
                        )}
                      >
                        <span
                          className={cn(
                            "grid h-6 w-6 shrink-0 place-items-center rounded-lg ring-1 ring-inset",
                            !n.readAt
                              ? "bg-accent/15 text-accent ring-accent/25"
                              : "bg-secondary/70 text-muted-foreground ring-border",
                          )}
                        >
                          <Bell className="h-3 w-3" />
                        </span>
                        <div className="min-w-0 flex-1">
                          <div className="truncate text-[12px] font-semibold text-foreground leading-tight">
                            {n.title}
                          </div>
                          <div className="mt-0.5 truncate text-[10px] text-muted-foreground">
                            {time}
                          </div>
                        </div>
                        {!n.readAt && (
                          <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-accent" />
                        )}
                      </Button>
                    </li>
                  );
                })}
              </ol>
            </div>
          )}
        </>
      )}

      <div className="border-t border-border/50 bg-card/50 px-3 py-2 text-center">
        <Link
          to="/admin/notifications"
          className="text-[10px] font-semibold uppercase tracking-[0.18em] text-muted-foreground transition hover:text-foreground"
        >
          Open Notification Center →
        </Link>
      </div>
    </aside>
    <NotificationDetailDialog
      notification={detail}
      open={detail !== null}
      onOpenChange={(o) => { if (!o) setDetail(null); }}
      onOpenLink={openLink}
    />
    </>
  );
}


/**
 * Dashboard shell — main content + sticky right rail (Live Feed + extras).
 * Any node passed as `fullWidthBelow` renders after the 2-col grid at the
 * page's full width — use it for wide tables that should not be squeezed
 * into the main column.
 */
export function DashboardShell({
  children,
  rightExtras,
  fullWidthBelow,
  fixedRightRail = false,
}: {
  children: React.ReactNode;
  rightExtras?: React.ReactNode;
  fullWidthBelow?: React.ReactNode;
  fixedRightRail?: boolean;
}) {
  return (
    <div data-dashboard-shell className="space-y-6">
      <div className="grid items-start gap-5 lg:grid-cols-[minmax(0,1fr)_320px] xl:gap-6">
        <div className="min-w-0 space-y-6">{children}</div>
        <div className="hidden min-w-0 lg:block">
          <div className={cn(
            "flex min-w-0 flex-col gap-4 pr-1",
            fixedRightRail
              ? "sticky top-[calc(4rem+env(safe-area-inset-top,0px))] max-h-[calc(100dvh-5rem)] overflow-y-auto overscroll-contain"
              : "sticky top-[calc(4rem+env(safe-area-inset-top,0px))] h-fit max-h-[calc(100dvh-5rem)] overflow-y-auto",
          )}>
            <LiveFeed />
            {rightExtras}
          </div>
        </div>
        {rightExtras && <div className="lg:hidden space-y-3">{rightExtras}</div>}
      </div>
      {fullWidthBelow}
    </div>
  );
}
