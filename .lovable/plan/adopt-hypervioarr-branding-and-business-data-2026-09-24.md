# Adopt Hypervioarr branding and business data

## Goal
Turn this remix into the PLUS 360 FAHRENHEIT SOLUTIONS system by matching Hypervioarr’s visual identity and copying its complete business dataset into this project’s own Lovable Cloud, without reconnecting to the source after migration.

## Branding and theme
- Replace the current logo, company name, browser identity, login presentation, shared brand mark, welcome copy, and user-facing page titles with PLUS 360 FAHRENHEIT SOLUTIONS.
- Apply Hypervioarr’s paper-white surfaces, near-black typography, signal-blue accent, Sora/Manrope type system, 1rem radius, restrained shadows, glass treatment, and matching dark mode through shared design tokens.
- Preserve the existing page structure, mobile fixes, permissions, formulas, workflows, and invoice-driven MIS behavior.
- Update cosmetic mobile app names and artwork while preserving compatibility-sensitive package identifiers and the locked notification integration.

## Full business-data migration
- Inventory every populated source table and its relationships, then export all accessible business records in dependency order.
- Copy organization settings, reference/setup lists, branches, clients, GST registrations, sites, contracts, contract resources, employees, assignments, attendance, payroll, invoices/MIS-related records, inventory, vehicles, properties, workflows, and related history.
- Preserve source record IDs where safe so cross-table links and historical references remain intact; map conflicting singleton or lookup records explicitly.
- Keep the destination isolated on its own Lovable Cloud after the one-time copy; no runtime reads or credentials from Hypervioarr.
- Preserve 8373914073 as the only account allowed to sign in. Imported employees remain business records only and receive no login access.

## Safety and validation
- Take destination row-count baselines before import and perform the copy transactionally in dependency batches.
- Validate row counts and orphan checks across clients, sites, contracts, employees, attendance, payroll, invoices, inventory, and assets.
- Verify representative records end-to-end and confirm dashboards, login, desktop navigation, and mobile layouts show the new brand and migrated totals.
- Confirm network activity points only to this project’s Lovable Cloud and that the original Hypervioarr project remains unchanged.

## Technical details
- Use data writes only for existing tables; add schema migrations solely if a source record requires a structure genuinely absent here.
- Reuse the source project’s logo through the managed asset flow rather than linking to its private asset pointer.
- Keep internal compatibility keys and native bundle identifiers unchanged unless they are user-visible labels.
- Do not modify iOS push behavior, provider integrations, authentication scope, attendance formulas, payroll calculations, billing calculations, or approval logic.
