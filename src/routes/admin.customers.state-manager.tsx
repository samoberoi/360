import { createFileRoute } from "@tanstack/react-router";
import { RecordViewButton } from "@/components/RecordViewButton";
import { useMemo, useState } from "react";
import { Download, Edit2, Link2, MapPin, Plus, Search } from "lucide-react";
import { DeleteGuardButton } from "@/components/DeleteGuardButton";
import { csvJoin, downloadCsv } from "@/lib/csv-export";
import { toast } from "sonner";
import { confirmAction } from "@/components/ConfirmProvider";
import { logActivity } from "@/lib/activity-log";
import { PageHeader, PageStat } from "@/components/PageHeader";
import { DataPagination, usePagination } from "@/components/DataPagination";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { useBranches, useStates, type State } from "@/lib/admin-data";

export const Route = createFileRoute("/admin/customers/state-manager")({
  head: () => ({
    meta: [
      { title: "State Manager | PLUS 360 FAHRENHEIT SOLUTIONS" },
      { name: "description", content: "Manage service states and branch mappings." },
      { property: "og:title", content: "State Manager | PLUS 360 FAHRENHEIT SOLUTIONS" },
      { property: "og:description", content: "Manage service states and branch mappings." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: StateManagerPage,
});

function StateManagerPage() {
  const { states, addState, updateState, deleteState } = useStates();
  const { branches } = useBranches();

  const [query, setQuery] = useState("");
  const [addOpen, setAddOpen] = useState(false);
  const [editing, setEditing] = useState<State | null>(null);
  const [deleting, setDeleting] = useState<State | null>(null);

  const mappedStateIds = useMemo(
    () => new Set(branches.map((b) => b.stateId)),
    [branches],
  );

  const filtered = useMemo(() => {
    const sorted = [...states].sort((a, b) => a.name.localeCompare(b.name));
    if (!query.trim()) return sorted;
    const q = query.trim().toLowerCase();
    return sorted.filter((s) => s.name.toLowerCase().includes(q));
  }, [states, query]);

  const mappedCount = states.filter((s) => mappedStateIds.has(s.id)).length;
  const pg = usePagination(filtered);

  return (
    <div>
      <PageHeader
        title="State Manager"
        eyebrow="Organizations"
        icon={MapPin}
        description="Service states and branch mappings."
        crumbs={[
          { label: "Organizations", to: "/admin/customers/customer-manager" },
          { label: "State Manager" },
        ]}
        kpis={
          <>
            <PageStat label="Total states" value={states.length} icon={MapPin} />
            <PageStat label="Mapped to branches" value={mappedCount} icon={Link2} tone="accent" />
            <PageStat
              label="Available"
              value={states.length - mappedCount}
              icon={Plus}
              tone="success"
            />
          </>
        }
      />

      {/* Toolbar */}
      <div className="mobile-directory-toolbar mobile-glass-surface mb-3 grid grid-cols-1 gap-1.5 rounded-xl border border-border/60 bg-card/70 p-2 sm:mb-4 sm:flex sm:items-center sm:justify-between sm:gap-2 sm:rounded-2xl sm:p-2.5">
        <div className="relative w-full sm:max-w-xs">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search states…"
            className="h-10 rounded-xl border-transparent bg-card/80 pl-9 shadow-sm focus-visible:border-accent/30"
          />
        </div>
        <div className="grid grid-cols-2 gap-1.5 sm:flex sm:gap-2">
          <Button
            variant="outline"
            onClick={() =>
              downloadCsv(
                "states",
                states.map((s) => ({
                  state: s.name,
                  mappedToBranch: mappedStateIds.has(s.id) ? "Yes" : "No",
                  branchCodes: csvJoin(
                    branches
                      .filter((b) => b.stateId === s.id)
                      .map((b) => b.code),
                  ),
                  branchNames: csvJoin(
                    branches
                      .filter((b) => b.stateId === s.id)
                      .map((b) => b.name || b.code),
                  ),
                })),
                [
                  { key: "state", header: "State" },
                  { key: "mappedToBranch", header: "Mapped to branch" },
                  { key: "branchCodes", header: "Mapped branch codes" },
                  { key: "branchNames", header: "Mapped branch names" },
                ],
              )
            }
            disabled={states.length === 0}
            className="h-9 rounded-lg px-2.5 text-xs sm:h-10 sm:rounded-xl sm:px-4 sm:text-sm"
          >
            <Download className="mr-1.5 h-4 w-4" />
            Export
          </Button>
          <Button
            onClick={() => setAddOpen(true)}
            className="h-9 rounded-lg bg-primary px-2.5 text-xs text-primary-foreground shadow-sm hover:bg-primary/90 sm:h-10 sm:rounded-xl sm:px-4 sm:text-sm"
          >
            <Plus className="mr-1.5 h-4 w-4" />
            Add state
          </Button>
        </div>
      </div>

      {/* Table */}
      <div className="overflow-hidden rounded-xl border border-border/60 bg-card/70 shadow-sm sm:rounded-2xl">
        <div className="flex items-center justify-between border-b border-border/60 bg-accent/[0.06] px-3 py-2 text-xs text-foreground sm:px-5 sm:py-2.5">
          <span className="inline-flex items-center gap-2"><span className="rounded-full bg-primary px-2.5 py-0.5 text-[11px] text-primary-foreground">{filtered.length}</span><span className="uppercase tracking-[0.14em] text-muted-foreground">Total {filtered.length === 1 ? "row" : "rows"}</span></span>
        </div>

        <div className="overflow-x-auto">
          <table className="ios-table w-full table-fixed text-sm">
            <thead className="bg-secondary/60 text-left text-[11px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
              <tr>
                <th className="px-5 py-3">#</th>
                <th className="px-5 py-3">State</th>
                <th className="px-5 py-3">Status</th>
                <th className="px-5 py-3 text-right" data-col="actions">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {pg.pageRows.map((s, i) => {
                const mapped = mappedStateIds.has(s.id);
                return (
                  <tr key={s.id} className="hover:bg-secondary/30">
                    <td data-label="#" className="px-5 py-3 font-mono text-xs text-muted-foreground">
                      {i + 1}
                    </td>
                    <td data-label="State" className="truncate px-5 py-3 font-medium text-foreground">
                      {s.name}
                    </td>
                    <td data-label="Status" className="px-5 py-3">
                      {mapped ? (
                        <Badge className="rounded-full bg-accent/15 font-semibold text-accent hover:bg-accent/20">
                          Mapped
                        </Badge>
                      ) : (
                        <Badge
                          variant="outline"
                          className="rounded-full border-border font-semibold text-muted-foreground"
                        >
                          Available
                        </Badge>
                      )}
                    </td>
                    <td data-label="Actions" className="px-5 py-3 text-right" data-col="actions">
                      <div className="inline-flex gap-1">
                        <RecordViewButton
                          record={s}
                          title="State details"
                          onEdit={() => setEditing(s)}
                        />
                        <Button
                          size="sm"
                          variant="ghost"
                          className="h-8 w-8 p-0 text-muted-foreground hover:text-foreground"
                          onClick={() => setEditing(s)}
                          aria-label="Edit"
                        >
                          <Edit2 className="h-4 w-4" />
                        </Button>
                        <DeleteGuardButton
                          id={s.id}
                          entityLabel="state"
                          checks={[{ table: "branches", column: "state_id", label: "branches" }]}
                          onDelete={() => setDeleting(s)}
                        />

                      </div>
                    </td>
                  </tr>
                );
              })}
              {filtered.length === 0 && (
                <tr>
                  <td colSpan={4} className="px-5 py-12 text-center text-sm text-muted-foreground">
                    No states found.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
          <DataPagination {...pg} />
        </div>
      </div>

      <StateFormDialog
        open={addOpen}
        onOpenChange={setAddOpen}
        title="Add state"
        onSubmit={async (name) => {
          const r = await addState(name);
          if (!r.ok) return r.error;
          void logActivity({ module: "State Manager", action: "create", entityType: "states", entityLabel: name, details: { name } });
          toast.success("State added");
          return null;
        }}
      />

      <StateFormDialog
        open={!!editing}
        initial={editing?.name}
        onOpenChange={(o) => !o && setEditing(null)}
        title="Edit state"
        onSubmit={async (name) => {
          if (!editing) return null;
          const r = await updateState(editing.id, name);
          if (!r.ok) return r.error;
          void logActivity({ module: "State Manager", action: "update", entityType: "states", entityId: editing.id, entityLabel: name, details: { name } });
          toast.success("State updated");
          setEditing(null);
          return null;
        }}
      />

      <AlertDialog open={!!deleting} onOpenChange={(o) => !o && setDeleting(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete state?</AlertDialogTitle>
            <AlertDialogDescription>
              This will remove <span className="font-semibold text-foreground">{deleting?.name}</span> from the list.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={async () => {
                if (!deleting) return;
                try {
                  const _delId = deleting.id;
                  const _delLabel = String((deleting as Record<string, unknown>).name ?? (deleting as Record<string, unknown>).code ?? _delId);
                  await deleteState(_delId);
                  void logActivity({ module: "State Manager", action: "delete", entityType: "states", entityId: _delId, entityLabel: _delLabel });
                  toast.success("State deleted");
                  setDeleting(null);
                } catch (e) {
                  toast.error(e instanceof Error ? e.message : "Delete failed");
                }
              }}
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}



function StateFormDialog({
  open,
  onOpenChange,
  title,
  initial,
  onSubmit,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  title: string;
  initial?: string;
  onSubmit: (name: string) => Promise<string | null> | string | null;
}) {
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);

  // Reset when dialog opens
  useMemo(() => {
    if (open) {
      setName(initial ?? "");
      setError(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="dialog-responsive state-form-dialog sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>
            States feed the branch mapping dropdown — each state can be mapped to one branch.
          </DialogDescription>
        </DialogHeader>
        <form
          onSubmit={async (e) => {
            e.preventDefault();
            const err = await onSubmit(name);
            if (err) setError(err);
            else {
              setName("");
              if (!initial) onOpenChange(false);
            }
          }}
          className="modern-business-form space-y-3"
        >
          <section className="modern-form-section">
            <Label htmlFor="state-name">State name</Label>
            <Input
              id="state-name"
              value={name}
              onChange={(e) => {
                setName(e.target.value);
                setError(null);
              }}
              placeholder="e.g. Maharashtra"
              autoFocus
            />
            {error && <p className="text-xs font-medium text-destructive">{error}</p>}
          </section>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" className="bg-primary text-primary-foreground hover:bg-primary/90">
              Save
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
