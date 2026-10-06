import { useMemo, useState } from "react";
import { LabeledMultiSelectFilter } from "@/components/MultiSelectFilter";

type GeoUnit = {
  id: string;
  code: string;
  name: string;
  customer_id: string;
  customer_name: string;
  billing_state: string | null;
  billing_city?: string | null;
};

const norm = (s: string | null | undefined) => (s ?? "").trim();

/** Organization → State → City → Unit cascading filters shared by Attendance, Payroll and Invoicing. */
export function useCharterGeoFilters<T extends GeoUnit>(units: T[]) {
  const [org, setOrg] = useState<string[]>([]);
  const [states, setStates] = useState<string[]>([]);
  const [cities, setCities] = useState<string[]>([]);
  const [unitIds, setUnitIds] = useState<string[]>([]);

  const byOrg = useMemo(
    () => units.filter((u) => org.length === 0 || org.includes(u.customer_id || u.customer_name)),
    [units, org],
  );
  const byState = useMemo(
    () => byOrg.filter((u) => states.length === 0 || states.includes(norm(u.billing_state))),
    [byOrg, states],
  );
  const byCity = useMemo(
    () => byState.filter((u) => cities.length === 0 || cities.includes(norm(u.billing_city))),
    [byState, cities],
  );

  const stateOptions = useMemo(
    () => [...new Set(byOrg.map((u) => norm(u.billing_state)).filter(Boolean))].sort().map((s) => ({ value: s, label: s })),
    [byOrg],
  );
  const cityOptions = useMemo(
    () => [...new Set(byState.map((u) => norm(u.billing_city)).filter(Boolean))].sort().map((s) => ({ value: s, label: s })),
    [byState],
  );

  const apply = (u: T) =>
    (org.length === 0 || org.includes(u.customer_id || u.customer_name)) &&
    (states.length === 0 || states.includes(norm(u.billing_state))) &&
    (cities.length === 0 || cities.includes(norm(u.billing_city))) &&
    (unitIds.length === 0 || unitIds.includes(u.id));

  const active = org.length + states.length + cities.length + unitIds.length > 0;
  const clear = () => {
    setOrg([]);
    setStates([]);
    setCities([]);
    setUnitIds([]);
  };

  const render = (organizations: { id: string; name: string; code: string }[]) => (
    <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-4">
      <LabeledMultiSelectFilter
        label="Organization"
        selected={org}
        onChange={(v) => {
          setOrg(v);
          setStates([]);
          setCities([]);
          setUnitIds([]);
        }}
        options={organizations.map((o) => ({ value: o.id, label: o.code ? `${o.code} · ${o.name}` : o.name }))}
        allLabel={`All organizations (${organizations.length})`}
      />
      <LabeledMultiSelectFilter
        label="State"
        selected={states}
        onChange={(v) => {
          setStates(v);
          setCities([]);
          setUnitIds([]);
        }}
        options={stateOptions}
        allLabel={`All states (${stateOptions.length})`}
      />
      <LabeledMultiSelectFilter
        label="City"
        selected={cities}
        onChange={(v) => {
          setCities(v);
          setUnitIds([]);
        }}
        options={cityOptions}
        allLabel={`All cities (${cityOptions.length})`}
      />
      <LabeledMultiSelectFilter
        label="Unit"
        selected={unitIds}
        onChange={setUnitIds}
        options={byCity.map((u) => ({
          value: u.id,
          label: `${u.name || u.code}${u.customer_name ? ` · ${u.customer_name}` : ""}`,
        }))}
        allLabel={`All units (${byCity.length})`}
      />
    </div>
  );

  return { apply, active, clear, render };
}
