# Mobile app UI re-review

## State-based GST branches and invoicing

- [x] Extract and verify Maharashtra, Telangana, Karnataka, Goa, and Gujarat GST certificates.
- [x] Add configurable GST registration details to Branch Manager.
- [x] Select the supplier registration by client state with Maharashtra head-office fallback.
- [x] Apply CGST + SGST for same-state billing and IGST-only for fallback/interstate billing.
- [x] Apply the same calculation to invoice preview/print, MIS, and individual/combined Tally exports.
- [x] Apply and verify the production migration and run TypeScript validation.

## Dashboard status-card number visibility

- [x] Keep Attendance, Payroll, and Invoicing figures fully visible without ellipsis or wrapping.
- [x] Preserve equal sizing and alignment across all three status cards.

## Consistent iOS-style mobile refinement

- [x] Align dashboard and all mobile surfaces to the bottom dock width.
- [x] Standardize compact buttons, switches, selectors, tabs, and action rows.
- [x] Add restrained glass treatment to floating and sticky mobile surfaces.
- [x] Re-audit attendance, sheets, onboarding, off-boarding, and shared forms for phone usability.
- [x] Run TypeScript and formatting validation.

- [x] Audit all mobile routes, shared components, and every form
- [x] Fix remaining alignment, placement, overflow, and clarity issues
- [x] Verify representative screens at narrow phone widths
- [x] Confirm checks and close remaining tasks

## Current request

- [x] Reconcile all 12-hour Maharashtra L&T guard contracts to their correct district rate-sheet columns.
- [x] Show final Billing instead of Gross and remove duplicate Billing/day from resource cards.
- [x] Show 27-, 26-, 25-, and 24-day billing rates together for every contract resource.
- [x] Put the rate matching the current calendar month first (31→27, 30→26, 29→25, 28→24).
- [x] Determine the highlighted daily rate from each contract's actual payroll window, including 21 Aug–20 Sep as 31 days.
- [x] Match Employees summary tiles to the shared dashboard theme.
- [x] Make Employees open faster with an instant cached list, progressive paging, retries, and deferred inventory loading.
- [x] Fix field officer unit visibility dynamically on dashboard and candidate posting.
- [x] Rename field officer Employees surface to Candidates.
- [x] Redesign mobile More panel without Menu/X and clipping.
- [x] Keep mobile form canvases flat; preserve rounded dashboards, tiles, and actions.
- [x] Verify Rohit's production access and validate the mobile code changes.

## Interface recovery

- [x] Restore rounded dashboards, tiles, and CTAs while keeping form canvases flat.
- [x] Diagnose the signed-in page-load failure and stop duplicate live-unit subscriptions from crashing the dashboard.
- [x] Verify the corrected mobile interface and production unit feed.

## Contacts form fix

- [x] Fix Contacts step completion and red status after valid entry.
- [x] Modernize the Contacts form while preserving mobile-first behavior.
- [x] Verify validation and visual layout.

## Required-field indicator audit

- [x] Match every Candidate wizard red asterisk to actual save and submit rules.
- [x] Mark conditional requirements only when the condition applies.
- [x] Verify all wizard steps and shared address fields.

## Candidate form modernization

- [x] Simplify the Candidate form header, progress, steps, and actions.
- [x] Standardize sections, fields, contacts, documents, and validation states.
- [x] Verify narrow Android, iPhone, tablet, and desktop layouts.

## Candidate guided workspace redesign

- [x] Replace the desktop step strip with a persistent guided sidebar.
- [x] Keep the mobile form focused with compact progress and anchored actions.
- [x] Apply the selected Cloud White direction while retaining the current font and form rules.

## All-form design standardization

- [x] Standardize shared inputs, dates, selectors, text areas, labels, checks, radios, and switches.
- [x] Apply the Candidate form's white canvas and system-blue states to editable dialogs and sheets.
- [x] Keep form canvases flat on mobile while preserving rounded dashboards, cards, tiles, and actions.
- [x] Cover bespoke dialog fields that do not use a form wrapper.
- [x] Verify formatting and mobile-safe action layouts.

## Employee-style business forms

- [x] Extend the white, system-blue form language across all shared form controls.
- [x] Modernize organization, client, state, branch, vehicle, contract, uniform, and asset form layouts.
- [x] Verify representative business forms at phone, tablet, and desktop widths.

## Convert all business forms to Candidate-style workflows

- [x] Inventory every create/edit form and classify wizard vs single-step.
- [x] Extract a reusable white-and-blue wizard shell with progress, completed steps, and mobile actions.
- [x] Convert organization, client/unit, state, branch, contract, uniform, item/product, vehicle, asset, and related forms.
- [x] Convert remaining operational forms while preserving validation, permissions, and saving.
- [x] Verify responsive form structure and project checks across phone, tablet, and desktop layouts.

## Field dashboard device card

- [x] Rebalance the My Device card so its status tiles and action fill the available height without a blank lower area.

## Candidate list and page headings

- [x] Add a clean empty Candidate state with a direct Add Candidate action.
- [x] Preserve totals, statuses, search, and candidate rows when records exist.
- [x] Remove the Home/location breadcrumb trail from shared page headings for every role.

- [x] Candidate form: left step list must scroll to Review (step 10); completion card overlaps it

## Employee dashboard redesign

- [x] Match Guard, billable, and non-billable employee dashboards to the Field Officer bento layout.
- [x] Preserve attendance, assignments, manager, team, device, and insights behavior.
- [x] Verify responsive layout and project checks.
- [x] Improve the profile-card image visibility and text contrast on mobile and desktop.
- [x] Show assigned unit locations and identify Primary and Secondary units.
- [x] Keep Duty and Unit cards white, color only their inner tiles, and label the profile card's primary unit.
- [x] Center attendance errors and confirm check-in/out with time and location.

## My Profile redesign

- [x] Replace net pay and employer-cost presentation with one CTC value for every employee profile.
- [x] Apply the selected Cloud White, system-blue, current-font bento profile design.
- [x] Preserve profile details, photo actions, postings, documents, settings, and sign-out behavior.
- [x] Rebuild My Profile as a full-width professional grid with a compact profile rail.
- [x] Normalize all card spacing, headers, gutters, padding, radii, and paired heights.
- [x] Remove Mobile App Status and keep the complete left profile/settings panel fixed on desktop.
- [x] Align profile content cards on one consistent grid.
- [x] Keep the profile rail sticky on standard laptop screens, not only extra-wide displays.

## Employee dashboard unit visibility

- [x] Trace the pictured employee's production unit mappings and explain why they are missing.
- [x] Show the primary unit and every secondary unit on the employee dashboard.
- [x] Verify the production data path and dashboard rendering.
- [x] Allow employees to read units explicitly assigned to them, regardless of branch scope.
- [x] Resolve dashboard units directly from the signed-in employee's authoritative unit list.
- [x] Replace multi-request assignment loading with one authenticated assignment resolver.
- [x] Keep the My Profile rail fixed while only profile details scroll on desktop.
- [x] Clean field officer dashboard tiles, terminology, navigation, profile devices, and attendance-gated site visits end-to-end
- [x] Revise candidate onboarding contacts, automatic codes, optional ESIC family, UAN availability and seven-day compliance dashboards

## Field officer inventory catalogue and request sources

- [x] Add only Uniform and Shoe with approved sizes.
- [x] Seed test stock across Rohit Joshi's primary unit and Radiant headquarters.
- [x] Limit field-officer request sources to primary unit first and headquarters second.
- [x] Limit the field-officer request catalogue to available Uniform and Shoe stock.
- [x] Verify the full request and fulfilment workflow in production.

## Field officer dashboard visit history

- [x] Show today's completed site visits below the next-visit action.
- [x] Link each visit and the next action to Radar.
- [x] Refresh dashboard history immediately after completing a visit.
- [x] Verify the dashboard visit history against production data.

## Welcome popup removal

- [x] Remove the automatic welcome popup from the admin interface.

## Field officer dashboard final cleanup

- [x] Remove most visited, least visited, and not visited cards.
- [x] Compact onboarding, rehire, and UAN tiles into one row above My Units.

## Field officer inventory workspace

- [x] Rename the dashboard Items tile to Inventory and connect it to Uniform Manager.
- [x] Add a field-officer stock dashboard for Uniform and Shoe quantities by size.
- [x] Connect Demands, Delivery Challans, Issuances, and Collections end-to-end.
- [x] Verify role scoping, navigation, and project checks.

## Field officer issuance guard scope

- [x] Restrict the issuance guard picker to the signed-in field officer’s assigned/onboarded guards only.
- [x] Verify Rohit’s production guard scope and run project checks.

## Issuance quantity validation

- [x] Make the visibly entered issued quantity authoritative when moving to Review.
- [x] Verify the field-officer issuance flow and project checks.

## Collections and security guard dashboard cleanup

- [x] Hide guards and unit groups with no recoverable inventory from Collections.
- [x] Align Collections totals, pending indicators, search, and empty state with recoverable stock.
- [x] Remove the guard dashboard portrait and apply the field-officer dashboard cleanup pattern.
- [x] Remove duplicate guard My Profile and Notifications tabs while keeping My Attendance.
- [x] Verify guard profile/notification access and run project checks.

## Missing contract designation follow-up

- [x] Show every enabled designation during client-unit onboarding and label out-of-contract choices.
- [x] Add a secure live seven-day exception feed scoped to Field Officers and Finance.
- [x] Add compact follow-up tiles and actionable detail lists to both dashboards.
- [x] Apply and verify the production migration, automatic resolution, and project checks.

## Verification key (SurePass) readiness

- [x] Confirm the app calls the provider with the key the owner issued (stored as SUREPASS_API_KEY), not the older expired key.
- [x] Make the stored key authoritative instead of the copy baked into server env code.
- [x] Add a production encrypted-database fallback when the deployment host does not inject the stored key.
- [x] Confirm the replacement key is active with the provider for Aadhaar and PAN verification.

## Field officer dashboard compaction and visit detail

- [x] Put Team and Present together in one mobile row while keeping Inventory full-width.
- [x] Show complete visit details from Radar on the dashboard, including feedback and proof details.
- [x] Put Pending onboarding and Pending rehire together in one mobile row.
- [x] Combine UAN and contract-designation follow-ups into one dashboard box.
- [ ] Validate the live mobile dashboard after the automatic deployment completes; TypeScript validation passed.

## Candidate UAN wording

- [x] Replace the personal UAN question with candidate-focused wording in onboarding.

## Operations documentation suite

- [x] Finalize attendance guide nomenclature and remove “Field Guide”.
- [ ] Create and verify site visit guide.
- [ ] Create and verify candidate onboarding guide.
- [ ] Create and verify inventory request and approval guide.
- [ ] Create and verify guard asset assignment guide.
- [ ] Create and verify manual unit attendance guide.
- [ ] Create and verify employee unit reassignment guide.

## Finance dashboard loading

- [ ] Remove the production dashboard timeout for Finance without widening RBAC access.
- [ ] Verify Swapnil's dashboard count and finance-data requests with his signed-in identity.

## Field officer client and reporting-head mapping

- [ ] Review every row in the uploaded mapping workbook.
- [ ] Match or create field officers only where the sheet provides a usable client ID/name.
- [ ] Assign matched field officers to the corresponding units and reporting heads.
- [ ] Verify all production mappings and produce a detailed PDF reconciliation report.

## Dashboard and contract loading performance

- [x] Replace Contracts full client preload with a compact contract-specific lookup.
- [x] Move dashboard lifecycle totals into one production summary call.
- [x] Verify production timings and TypeScript validation; production screen verification follows deployment.

## Contract payroll-window navigation

- [x] Add one contract-driven payroll-window and cycle selector to Attendance, Payroll, and Invoicing.
- [x] Filter units, totals, lifecycle counts, searches, exports, and pagination to the selected window.
- [x] Pass exact period dates into Attendance, Payroll, and Invoice registers.
- [x] Validate production window assignments and TypeScript.
- [x] Multi-select filters (org/client/status) via shared MultiSelectFilter on Contracts, Attendance, Payroll, Invoicing
- [x] Show the highlighted month/year selector beside the payroll-window selector on all three screens.
- [x] Compact Invoice search and add All, Ready, Open, and Processed status filtering before pagination.
- [x] Add the contract payroll-window selector to the leadership dashboard and filter lifecycle/financial totals by it.

## Invoice output cleanup

- [x] Show CGST at 9% and SGST at 9% separately in invoice preview and print output; remove IGST.
- [x] Remove the Tally Billing File XLSX action from the invoice header.

## Tally invoice upload

- [x] Add secure per-invoice Tally invoice storage and production migration
- [x] Add Upload Tally Invoice and View controls on invoice details
- [x] Validate types and invoice workflow

## Attendance and payroll status filters

- [x] Add Attendance Open and Attendance Approved filtering beside search.
- [x] Add Payroll Open and Payroll Processed filtering beside search.
- [x] Validate filtering before pagination and run TypeScript checks.

## CLI3851 invoice percentage explanation

- [x] Confirm the values behind the displayed 87% and explain the calculation without changing data.

## Tally export (combined + per-invoice)

- [x] Restore Download Tally Format on invoice detail using the established Tally workbook layout.
- [x] Add Download Tally Format on the invoice list as one combined workbook for all filtered invoices.
- [x] Shorten MIS Format (XLSX) to MIS Format on both invoice screens.
- [x] bunx tsgo --noEmit passes.

## Document scanning for attendance photos — done

- src/lib/document-scan.ts: paper detection, perspective correction, shadow flattening, sharpening, quality scoring with guidance hints.
- src/components/DocumentScanCamera.tsx: live camera with real-time coaching and auto-capture when clear.
- Wired into attendance upload dialog (scan on manual upload, cleaned/original toggle, per-photo tips) and Migration Utility photo uploads.

## Full mobile-app interface optimization

- [x] Standardize the shared mobile shell, spacing, typography, actions, dialogs, sheets, tables, and safe areas.
- [x] Reduce nonessential on-screen copy and prioritize task-critical information across every authenticated screen.
- [x] Optimize dashboards, attendance, payroll, invoicing, contracts, employees, inventory, compliance, and settings for phone-first use.
- [ ] Verify representative role-based flows after a signed-in production session is available.
- [x] Run TypeScript validation and resolve mobile regressions without changing business rules or locked native push infrastructure.

## Mobile shell and dock refinement

- [x] Replace the footer-like bottom bar with a compact elevated app dock.
- [x] Rebuild the More panel as a clean two-column app launcher.
- [x] Reclaim phone width and vertical space across the shared signed-in shell.
- [ ] Visually verify authenticated screens; blocked until a signed-in session is available.

## iOS-style mobile interface refinement

- [x] Audit shared shell, controls, dialogs, cards, tables, and every route at phone widths.
- [x] Apply a unified iOS-inspired mobile visual system with minimal copy and safe-area spacing.
- [x] Fix clipping, overflow, action placement, toggles, filters, and dense record layouts globally.
- [x] Apply targeted fixes to screens that cannot inherit the shared improvements.
- [x] Run TypeScript validation; production visual verification follows deployment.

- [x] Make the mobile bottom dock black, matching the desktop navigation.
- [x] Remove bold/black typography from the interface; retain regular and medium weights only.

## Full-width mobile app refinement

- [x] Align phone cards and page content to the floating dock edges.
- [x] Replace the separate More drawer with an expanding black dock.
- [x] Rework the Payroll top controls for mobile.
- [x] Finish the cross-page data, table, and form visibility audit.
- [x] Run final TypeScript and responsive integrity checks.

## Mobile attendance entry

- [x] Replace the phone spreadsheet with a day-first employee attendance list.
- [x] Add one-tap attendance codes, employee selection, bulk marking, and compact Extra Duty entry.
- [x] Keep scanning, workflow status, payroll periods, roster mapping, desktop Form XVI, and print behavior intact.
- [x] Validate TypeScript and formatting without changing attendance rules or production data.

## Full mobile screen audit

- [x] Audit Control Center, Attendance, Employee/Candidate, and Client/Organization screens at phone widths.
- [x] Normalize page gutters, compact actions, filter rows, data cards, forms, dialogs, and tables without changing workflows.
- [x] Validate TypeScript and formatting; production visual verification follows deployment.

## Screenshot-specific mobile fixes

- [x] Compact State Manager list and make edit/view dialogs content-sized on phones.
- [x] Tighten employee cards and candidate onboarding while preserving all fields and actions.
- [x] Improve attendance top controls/status/history and prevent dock overlap.
- [x] Simplify Inventory dashboard density and mobile actions.
- [x] Validate types and formatting.

## End-to-end mobile app refinement

- [x] Audit every authenticated screen and shared control at phone width.
- [x] Standardize mobile typography, controls, cards, toolbars, dialogs, tables, and motion.
- [x] Refine people, client, contract, attendance, payroll, invoice, inventory, and control-center screens.
- [x] Verify TypeScript and formatting without changing business workflows.
- [ ] Verify authenticated production phone rendering after deployment.

- [x] Prevent every mobile form, modal, sticky action bar, and content panel from overlapping the bottom dock.

## Mobile employee and contract forms

- [x] Optimize employee onboarding and editing for focused, one-handed mobile use.
- [x] Optimize contract creation and editing with compact steps, fields, and dock-safe actions.
- [x] Verify phone layouts and run TypeScript and formatting checks.

## Consistent operational summary tiles

- [x] Standardize Attendance, Invoice, Payroll, Employees, Contracts, and manager summaries with colorful icon-led tiles.
- [x] Give every shared page statistic a meaningful icon and stable accent color.
- [x] Keep mobile summary rows compact, swipeable, and aligned to the app content width.

- [x] Standardize compact mobile filters, buttons, toggles, and list cards across Employees, Contracts, Clients, Organizations, States, Branches, and related admin directories.

## Mobile muster-grid attendance entry

- [x] Replace the separate day-first mobile cards with a compact, desktop-consistent muster grid.
- [x] Make every eligible day cell directly editable on phones while preserving ED and restrictions.
- [x] Keep employee identity visible during horizontal scrolling and retain bulk entry.
- [x] Run TypeScript and formatting validation.

- [x] Simplify multi-employee mobile attendance entry and bulk actions
- [x] Fix dashboard and module stat values to stay single-line
- [x] Repair candidate editor mobile header/footer and employee stat alignment
- [x] Review listed operational screens for shared mobile consistency

## Notification and mobile drawer polish

- [x] Redesign the mobile notification drawer with clearer hierarchy and compact actions.
- [x] Add meaningful colored icons for each notification category.
- [x] Match More, dialogs, drawers, sheets, and confirmations to the same blurred backdrop treatment.
- [x] Run TypeScript and formatting validation.

## Dashboard card consistency and More blur

- [x] Standardize dashboard card heights, spacing, radii, icons, labels, and value sizing.
- [x] Keep Dashboard, Attendance, Payroll, and Invoicing values on one line.
- [x] Strengthen the full-page More blur below the expanded black dock.
- [x] Run TypeScript validation; live authenticated phone rendering requires a signed-in production session.

## Mobile attendance employee column

- [x] Widen the frozen employee column so names and identifiers remain visible.
- [x] Keep employee names and details on single lines with clean truncation.
- [x] Use a solid white background across the full frozen name and Extra Duty cells.
- [x] Remove the spilling selected-row fill while retaining a clear selection outline.
- [x] Run TypeScript validation.

## Add Candidate dialog renders blank (FIXED)
- [x] Fix blank white body when opening Add Candidate from Employees (only Save Draft/Next render)
- [x] Review all other forms/dialogs for the same blank-content issue

## Pagination label alignment
- [x] Keep Previous, page numbers, and Next on one horizontal line without clipped text.

## Candidate-style Control Center forms
- [x] Apply one consistent Candidate-style layout to every Control Center create/edit dialog.
- [x] Align full-page Control Center forms to the same sections, fields, toggles, and actions.
- [x] Verify short and long forms on mobile and desktop and run TypeScript validation.

## Control Center form UI parity correction

- [x] Replace compact dialog-sheet geometry with the Candidate form's full white mobile workspace.
- [x] Apply the shared frame, field, section, header, and fixed-action treatment to every editable dialog.
- [x] Verify representative short, long, and sectioned dialog structures across phone and desktop rules.
- [x] Run TypeScript validation.

## Manager data scoping to their field officers
- [ ] Operations managers / branch managers / VP Operations see only cumulative data for the field officers reporting to them.
- [ ] Apply the same subtree scope to the operations overview, radar summary, reportees and people insights.
- [ ] Run TypeScript validation.

## Multiple field officers per unit
- [ ] Allow assigning more than one field officer to a unit.

## Manager data scoping to their field officers
- [x] Shared `useOperationalUnitScope` (field officer own units, manager = units of their field officer reportees)
- [x] Dashboard headline counts, operations overview, radar summary scoped
- [x] Reportees page and people insights scoped
- [x] Attendance, payroll, invoice, unit and organization lists scoped
- [x] Multiple field officers per unit (already supported via employee_scope_assignments; unique key allows many per unit)

## End-to-end core screen loading reliability

- [x] Make Leadership dashboard counts retry transient failures, retain the last valid period snapshot, and isolate lifecycle totals so they cannot crash the page.
- [x] Simplify Payroll: remove gross-to-date, deployed counts, attendance status, and per-unit payroll totals; keep name, contract ID, and right-aligned Payroll Open.
- [ ] Bound authentication and shared data requests; add visible retry states.
- [ ] Consolidate manager and Field Officer scope loading in production.
- [ ] Remove duplicate/unbounded list requests across Dashboard, Clients, Contracts, and Employees.
- [ ] Flatten and protect Attendance, Payroll, and Invoice loading paths.
- [ ] Optimize measured production functions and supporting indexes.
- [ ] Validate production timings, TypeScript, and live production behavior.
- [x] Remove per-keystroke Employees search requests and the yellow search focus treatment.
- [x] Compact Employees totals and replace long client names with hoverable client IDs.
- [x] Remove approval cycle health, today's committed attendance, and workforce deployment panels from leadership dashboards.
- [x] Remove all in-app status toast pop-ups while preserving push notifications.
- [x] Remove the map from Field Officer site visits; keep Radar maps restricted to permitted control-center users.

## State-based GST branches and invoicing

- [ ] Extract and verify the five uploaded GST certificates.
- [ ] Update production branch GST names, numbers, and registered addresses.
- [ ] Make invoice origin branch configurable by client state with Maharashtra fallback.
- [ ] Show CGST + SGST for same-state billing and IGST only for interstate billing.
- [ ] Apply the rule to invoice preview, print, MIS, and Tally outputs.
- [ ] Validate production data, calculations, and TypeScript.
- [x] Fix attendance upload: resolve/create people, map primary guards, preserve relievers, then save attendance end to end

## Leadership dashboard and Control Center permissions

- [x] Make dashboard variants depend on the verified current role instead of stale cached permission shapes.
- [x] Register every Control Center tool and filter tiles by its exact permission.
- [x] Return denied Control Center routes to Control Center instead of Deduction Types.
- [x] Apply and verify the missing permission rows in production.
- [x] Run TypeScript and formatting validation.
- [x] Invoice charter: State + City dropdown filters next to search/Invoice-ready (billing_city added to get_attendance_charter_units RPC, applied to prod)
- [x] Invoice rows: drop % circle, Attendance badge, Contracted/Invoice-to-date/Payroll-to-date/margin; show name, deployed, client ID, contract ID, status badge right
- [x] Payroll rows: show client ID + contract ID alongside Payroll Open status

- Transport role: full Vehicles + Assets access (incl. Asset master), and a Fleet & Assets dashboard with no leadership snapshot or payroll window.
- [x] Transport role: Control Center fully hidden — removed asset_manager grant and turned off control_center parent view in prod (db/prod-migrations/20260923030500_transport_remove_control_center.sql); menu and direct /admin/control-center access now blocked for transport.
- L&T Finance billing rates reconciled to the client cost sheet for Gujarat/Rajasthan/Telangana/Karnataka (admin + service charge split, 27-day billing divisor). Armed rates not applied — no armed guard lines exist on L&T sites.

## Done: CLI4317 attendance swap
- 31 attendance rows at CLI4317 (Nokha) moved from 47068 (Inder Singh) to 48001 (Anil); Anil posted primary at CLI4317; Inder Singh restored primary at CLI4326 (Neem Ka Thana). Migration 20260923100000.

- Merged Jaya Nagar stub employees: "4678048629" Shiroppa -> 48629 Shivappa Bhajantri, "EMP-105" chandro Bahadur -> 46780 Chandra Bahadur Thapa (db/prod-migrations/20260923110500_merge_jaya_nagar_stub_employees.sql).
- [x] Created L&T Karnataka sites CLI4504 Mudhol, CLI4505 Naragund, CLI4506 Ramdurg with contracts CON16191-16193 cloned from CLI4500 (Karnataka 12h structure)

- [x] Added "Days Minus Four" payroll/billing day basis (actual period days − 4) and applied it to all 199 active L&T contract resources; MIS "OT Rate" now labelled per day.

- L&T 26->27 present days: absorbed one extra-duty day into attendance for all 21-20 window L&T sites (Aug 21 - Sep 20 2026). Migrations 20260923150000 / 151000 / 152000. 46 people now at 27; 1 reliever skipped (relievers cannot hold present codes).

- Merged duplicate L&T contracts (CON14918→16000, 14898→15978, 14915→15993, 14910→15989, 14907→15986, 14906→15985): postings, attendance, sheets and payroll runs moved to survivors; old contracts expired 2026-09-23 (db/prod-migrations/20260923163000_merge_duplicate_lt_contracts.sql).
- [x] Employee edits: removed the delayed form reload that overwrote changes, verify the saved role after updates, and restored Pankaj Zate (49258) to Field Officer in production.

## PLUS 360 remix migration

- [x] Apply PLUS 360 visual identity and logo without changing authentication or locked native notifications.
- [ ] Add missing compatible business structures from Hypervioarr.
- [ ] Import accessible clients, sites, contracts, employees, attendance, and configuration into this project's isolated backend.
- [ ] Validate imported counts and relationships, app checks, sign-in, and old-project isolation.
