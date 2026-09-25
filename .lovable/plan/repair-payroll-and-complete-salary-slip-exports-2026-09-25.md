# Repair payroll and complete salary-slip exports

## Outcome
Payroll will show reliable non-zero figures where attendance and rates exist, with a clear earning/deduction bifurcation. Each employee and the full run can be downloaded as either PDF or Excel.

## Changes
- Trace zero rows back to attendance, designation, contract rate, or saved payroll snapshot instead of masking them.
- Build salary slips from the frozen approved snapshot, with a safe live-calculation fallback only when a valid snapshot is unavailable.
- Replace generic Basic/DA/Other and PF/ESI/Other summaries with every saved earning, addition, and deduction head, plus attendance, gross, total deductions, and net pay.
- Add separate PDF and Excel actions beside each employee.
- Add separate bulk PDF and Excel actions for the full payroll run; the bulk PDF will contain one salary slip per employee.
- Keep approved figures frozen so later contract or attendance edits do not silently rewrite an issued slip.

## Verification
- Test against the processed August CRC Flagship payroll and inspect representative non-zero and zero rows.
- Download and inspect individual PDF, individual Excel, bulk PDF, and bulk Excel.
- Confirm totals and component sums match the approved payroll snapshot and that the app remains error-free.

## Technical details
- Extend the wage-slip data model to carry dynamic earning/addition/deduction lines.
- Reuse the existing Form XVI PDF renderer and add a combined multi-page renderer for bulk export.
- Generate spreadsheet rows dynamically from saved payroll heads rather than fixed fields.
