import type { WageSlipData } from "@/lib/company-documents";

const safeName = (value: string) =>
  value.replace(/[\\/?*:[\]]/g, " ").replace(/\s+/g, " ").trim().slice(0, 31) || "Salary Slip";

const safeFile = (value: string) =>
  value.replace(/[^a-z0-9._-]+/gi, "-").replace(/-+/g, "-").replace(/^-|-$/g, "") || "salary-slip";

export async function downloadWageSlipsXlsx(slips: WageSlipData[], filename: string): Promise<void> {
  if (slips.length === 0) throw new Error("No salary slips are available to download");

  const XLSX = await import("xlsx-js-style");
  const workbook = XLSX.utils.book_new();
  const usedNames = new Set<string>();

  slips.forEach((slip, index) => {
    const rows: unknown[][] = [
      ["PLUS 360 FAHRENHEIT SOLUTIONS PVT. LTD."],
      ["SALARY SLIP", slip.period],
      [],
      ["Employee Name", slip.employeeName, "Employee Code", slip.employeeCode],
      ["Designation", slip.designation, "UAN", slip.uan || "—"],
      ["Bank Account", slip.bankAccountNumber || "—", "Wage Period", slip.wagePeriod],
      ["Establishment / Site", slip.establishmentAddress],
      [],
      ["Earnings", "Amount (₹)", "Deductions", "Amount (₹)"],
      ["Basic", slip.rateBasic, "PF", slip.dedPf],
      ["DA", slip.rateDa, "ESI", slip.dedEsi],
      ["Other earnings", slip.rateOther, "Other deductions", slip.dedOthers],
      ["Extra Duty wages", slip.extraDutyWages, "Total deductions", slip.totalDeductions],
      ["Gross wages", slip.grossWages, "Net wages", slip.netWages],
      [],
      ["Total attendance", slip.totalAttendance],
    ];
    const sheet = XLSX.utils.aoa_to_sheet(rows);
    sheet["!merges"] = [
      { s: { r: 0, c: 0 }, e: { r: 0, c: 3 } },
      { s: { r: 6, c: 1 }, e: { r: 6, c: 3 } },
      { s: { r: 15, c: 1 }, e: { r: 15, c: 3 } },
    ];
    sheet["!cols"] = [{ wch: 22 }, { wch: 26 }, { wch: 22 }, { wch: 24 }];
    sheet["!rows"] = rows.map((_, row) => ({ hpt: row === 0 ? 28 : row === 1 ? 24 : 20 }));

    const border = {
      top: { style: "thin", color: { rgb: "CBD5E1" } },
      bottom: { style: "thin", color: { rgb: "CBD5E1" } },
      left: { style: "thin", color: { rgb: "CBD5E1" } },
      right: { style: "thin", color: { rgb: "CBD5E1" } },
    };
    for (let row = 0; row < rows.length; row += 1) {
      for (let col = 0; col < 4; col += 1) {
        const address = XLSX.utils.encode_cell({ r: row, c: col });
        const cell = sheet[address] as { s?: unknown; z?: string } | undefined;
        if (!cell) continue;
        const isTitle = row === 0;
        const isSubtitle = row === 1;
        const isHeader = row === 8;
        const isTotal = row === 13;
        cell.s = {
          font: {
            name: "Arial",
            sz: isTitle ? 15 : isSubtitle ? 13 : 10,
            bold: isTitle || isSubtitle || isHeader || isTotal || col % 2 === 0,
            color: { rgb: isTitle || isHeader ? "FFFFFF" : "111827" },
          },
          fill: {
            patternType: "solid",
            fgColor: { rgb: isTitle ? "111827" : isHeader ? "2563EB" : isTotal ? "DBEAFE" : "FFFFFF" },
          },
          alignment: {
            vertical: "center",
            horizontal: isTitle ? "center" : col === 1 || col === 3 ? "right" : "left",
            wrapText: true,
          },
          border: row >= 3 && row !== 7 && row !== 14 ? border : undefined,
        };
        if (row >= 9 && row <= 13 && (col === 1 || col === 3)) cell.z = '₹#,##0.00;(₹#,##0.00);-';
      }
    }

    let sheetName = safeName(`${slip.employeeCode || index + 1} ${slip.employeeName}`);
    let suffix = 2;
    while (usedNames.has(sheetName)) {
      sheetName = safeName(`${slip.employeeCode || index + 1} ${slip.employeeName} ${suffix}`);
      suffix += 1;
    }
    usedNames.add(sheetName);
    XLSX.utils.book_append_sheet(workbook, sheet, sheetName);
  });

  XLSX.writeFile(workbook, `${safeFile(filename)}.xlsx`);
}