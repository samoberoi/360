import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";

export type ReportVisit = {
  date: string;
  unit: string;
  officer: string;
  checkIn: string;
  checkOut: string | null;
  rating: number | null;
  client: string | null;
  notes: string | null;
};

export type ReportSummary = {
  total: number;
  completed: number;
  inProgress: number;
  avgRating: number | null;
  ratedCount: number;
  officers: number;
  unitsCovered: number;
};

export type ReportInput = {
  logoSrc: string;
  customerName: string;
  unitNames: string[];
  rangeLabel: string;
  rangeStart: string;
  rangeEnd: string;
  generatedAt: string;
  summary: ReportSummary;
  visits: ReportVisit[];
};

async function loadDataUrl(src: string): Promise<string | null> {
  try {
    const res = await fetch(src);
    const blob = await res.blob();
    return await new Promise((resolve) => {
      const r = new FileReader();
      r.onload = () => resolve(String(r.result));
      r.onerror = () => resolve(null);
      r.readAsDataURL(blob);
    });
  } catch {
    return null;
  }
}

function fmtTime(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", hour12: true });
}
function fmtDate(s: string): string {
  return new Date(s + "T00:00:00").toLocaleDateString(undefined, { day: "2-digit", month: "short", year: "numeric" });
}
function fmtDur(a: string, b: string | null): string {
  if (!b) return "—";
  const ms = new Date(b).getTime() - new Date(a).getTime();
  if (!Number.isFinite(ms) || ms <= 0) return "—";
  const mins = Math.round(ms / 60000);
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

export async function generateReportPdf(input: ReportInput): Promise<void> {
  const doc = new jsPDF({ orientation: "landscape", unit: "pt", format: "a4" });
  const pageW = doc.internal.pageSize.getWidth();
  const pageH = doc.internal.pageSize.getHeight();
  const margin = 32;

  const brand: [number, number, number] = [24, 24, 27]; // near-black
  const gold: [number, number, number] = [201, 162, 39];
  const muted: [number, number, number] = [110, 116, 129];

  // ---------- Header band ----------
  doc.setFillColor(...brand);
  doc.rect(0, 0, pageW, 78, "F");
  doc.setFillColor(...gold);
  doc.rect(0, 78, pageW, 3, "F");

  const logoData = await loadDataUrl(input.logoSrc);
  if (logoData) {
    try {
      doc.addImage(logoData, "PNG", margin, 14, 52, 52);
    } catch {
      // ignore
    }
  }

  doc.setTextColor(255, 255, 255);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(18);
  doc.text("RADIANT GUARD SERVICES", margin + 62, 36);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(9.5);
  doc.setTextColor(220, 220, 220);
  doc.text("Radar · Site Visit Report", margin + 62, 52);

  // Right side: organization + units
  const rightX = pageW - margin;
  doc.setFont("helvetica", "bold");
  doc.setFontSize(11);
  doc.setTextColor(255, 255, 255);
  doc.text(input.customerName, rightX, 32, { align: "right" });
  doc.setFont("helvetica", "normal");
  doc.setFontSize(8.5);
  doc.setTextColor(220, 220, 220);
  const unitCountLabel =
    input.unitNames.length === 1 ? "1 client in scope" : `${input.unitNames.length} clients in scope`;
  doc.text(unitCountLabel, rightX, 47, { align: "right" });
  doc.setFontSize(8);
  doc.setTextColor(255, 210, 120);
  doc.text(input.rangeLabel.toUpperCase(), rightX, 62, { align: "right" });

  // ---------- Meta strip ----------
  let cursorY = 100;
  doc.setTextColor(...muted);
  doc.setFontSize(8);
  doc.setFont("helvetica", "bold");
  doc.text("REPORTING PERIOD", margin, cursorY);
  doc.text("GENERATED", margin + 220, cursorY);
  doc.text("SCOPE", margin + 420, cursorY);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(10);
  doc.setTextColor(30, 30, 30);
  const periodTxt =
    input.rangeStart === input.rangeEnd
      ? fmtDate(input.rangeStart)
      : `${fmtDate(input.rangeStart)} — ${fmtDate(input.rangeEnd)}`;
  doc.text(periodTxt, margin, cursorY + 14);
  doc.text(new Date(input.generatedAt).toLocaleString(), margin + 220, cursorY + 14);
  doc.text(`${input.unitNames.length === 1 ? input.unitNames[0] : `${input.unitNames.length} units`}`, margin + 420, cursorY + 14);

  // ---------- Summary boxes ----------
  cursorY = 138;
  const tiles: { label: string; value: string }[] = [
    { label: "Total visits", value: String(input.summary.total) },
    { label: "Completed", value: String(input.summary.completed) },
    { label: "In progress", value: String(input.summary.inProgress) },
    { label: "Avg rating", value: input.summary.avgRating != null ? `${input.summary.avgRating.toFixed(2)} / 5` : "—" },
    { label: "Officers", value: String(input.summary.officers) },
    { label: "Clients covered", value: String(input.summary.unitsCovered) },
  ];
  const gap = 10;
  const tileW = (pageW - margin * 2 - gap * (tiles.length - 1)) / tiles.length;
  tiles.forEach((t, i) => {
    const x = margin + i * (tileW + gap);
    doc.setDrawColor(220, 222, 228);
    doc.setFillColor(250, 250, 252);
    doc.roundedRect(x, cursorY, tileW, 52, 6, 6, "FD");
    doc.setTextColor(...muted);
    doc.setFontSize(7.5);
    doc.setFont("helvetica", "bold");
    doc.text(t.label.toUpperCase(), x + 10, cursorY + 16);
    doc.setTextColor(20, 20, 20);
    doc.setFontSize(14);
    doc.text(t.value, x + 10, cursorY + 38);
  });

  // ---------- Units in scope ----------
  let tableStartY = cursorY + 68;
  {
    const blockX = margin;
    const blockW = pageW - margin * 2;
    const headerY = tableStartY;
    doc.setFont("helvetica", "bold");
    doc.setFontSize(8);
    doc.setTextColor(...muted);
    doc.text(`UNITS IN SCOPE (${input.unitNames.length})`, blockX, headerY);

    doc.setFont("helvetica", "normal");
    doc.setFontSize(9.5);
    doc.setTextColor(30, 30, 30);
    const unitsText = input.unitNames.length ? input.unitNames.join("  •  ") : "—";
    const lines = doc.splitTextToSize(unitsText, blockW - 16) as string[];
    const lineH = 12;
    const padY = 10;
    const boxH = padY * 2 + lines.length * lineH;
    const boxY = headerY + 6;
    doc.setDrawColor(220, 222, 228);
    doc.setFillColor(250, 250, 252);
    doc.roundedRect(blockX, boxY, blockW, boxH, 6, 6, "FD");
    doc.text(lines, blockX + 8, boxY + padY + 9);
    tableStartY = boxY + boxH + 14;
  }

  // ---------- Visits table ----------
  autoTable(doc, {
    startY: tableStartY,
    margin: { left: margin, right: margin, bottom: 40 },
    head: [["Date", "Client", "Field Officer", "Check-in", "Check-out", "Duration", "Rating", "Client", "Notes"]],
    body: input.visits.map((v) => [
      fmtDate(v.date),
      v.unit,
      v.officer,
      fmtTime(v.checkIn),
      fmtTime(v.checkOut),
      fmtDur(v.checkIn, v.checkOut),
      v.rating != null ? `${v.rating} / 5` : "—",
      v.client ?? "—",
      (v.notes ?? "—").slice(0, 140),
    ]),
    styles: { font: "helvetica", fontSize: 8.5, cellPadding: 5, textColor: [30, 30, 30], lineColor: [230, 230, 235], lineWidth: 0.4 },
    headStyles: { fillColor: brand, textColor: [255, 255, 255], fontStyle: "bold", fontSize: 8.5 },
    alternateRowStyles: { fillColor: [248, 248, 250] },
    columnStyles: {
      0: { cellWidth: 68 },
      3: { cellWidth: 55 },
      4: { cellWidth: 55 },
      5: { cellWidth: 55 },
      6: { cellWidth: 48 },
      8: { cellWidth: "auto" },
    },
    didDrawPage: () => {
      // Footer
      const y = pageH - 22;
      doc.setDrawColor(220, 222, 228);
      doc.line(margin, y - 8, pageW - margin, y - 8);
      doc.setFont("helvetica", "normal");
      doc.setFontSize(8);
      doc.setTextColor(...muted);
      doc.text("PLUS 360 FAHRENHEIT SOLUTIONS · Confidential — for client use only.", margin, y);
      const pageNum = doc.getNumberOfPages();
      doc.text(`Page ${pageNum}`, pageW - margin, y, { align: "right" });
    },
  });

  const safeCust = input.customerName.replace(/[^a-z0-9]+/gi, "-").toLowerCase();
  const stamp = input.rangeStart === input.rangeEnd ? input.rangeStart : `${input.rangeStart}_to_${input.rangeEnd}`;
  doc.save(`radiant-field-report_${safeCust}_${stamp}.pdf`);
}
