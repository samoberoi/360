// Purchase Order PDF generator — mirrors the standard PLUS 360 PO format.
import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";
import logoUrl from "@/assets/radiant-logo-v2.png";

export type POPdfVendor = {
  vendor_code: string;
  name: string;
  phone: string;
  email: string;
  gstin: string;
  address1: string;
  address2: string;
  city: string;
  state: string;
  pincode: string;
  country: string;
};

export type POPdfLine = {
  item_code: string;
  item_name: string;
  unit: string;
  size_value?: string;
  qty: number;
  unit_price: number;
  tax_percent: number; // assumed equal across lines for CGST/SGST split
};

export type POPdfData = {
  po_number: string;
  po_date: string; // ISO yyyy-mm-dd
  remarks?: string;
  vendor: POPdfVendor | null;
  ordering_from?: string;
  deliver_to?: string;
  lines: POPdfLine[];
};

const COMPANY = {
  name: "PLUS 360 FAHRENHEIT SOLUTIONS PVT. LTD.",
  address: "Office No. 818, 8th Floor, Clover Hills Plaza, NIBM Road, Pune. 411048",
  phone: "02048622515",
  email: "info@radiantguards.com",
  gstin: "27AAECR2832A1ZT",
  cin: "",
};

const TERMS: string[] = [
  "The Vendor represents and warrants that it has the right to and shall sell the Goods free of any charge, lien or other encumbrance.",
  "The Vendor shall ensure that the Goods shall be of satisfactory quality and fit for usage and consumption by the Purchaser and that the goods supplied shall be free from defects in design, material and workmanship;",
  "The Vendor shall keep the purchaser indemnified in full against all costs, expenses, damages and losses (whether direct or indirect), including any interest, penalties, and legal and other professional fees and expenses awarded against or incurred or paid by the purchaser as a result of or in connection with any act that causes loos to the Purchaser due to the negligence of the Vendor.",
  "The Vendor shall make full disclosures to the purchases regarding its registration as a business entity, MSME status, statutory as well as GST compliances. The Vendor shall furnish the updated documents in relation to the aforementioned. The Vendor shall understand and admit that all such requisite disclosures made to the Purchases are true and to the best of their knowledge.",
  "In case of non-adherence to the above clause, the Purchaser shall not entertain the MSME status of the concerned vendor.",
  "The purchaser reserves the right at any time before or after delivery to inspect and test the Goods in concern.",
  "Timely payments shall be made by the purchaser subject to timely submission of invoice.",
  "Similarly, GST shall be paid by the Purchaser only in case the Vendor is fully compliant to the statutory GST norms.",
  "The purchaser shall pay correctly rendered invoices within 45 days from the date of receiving the invoice. In case of any observations or objections w.r.t. the period of payment, the date of invoice shall be taken as the beginning of the 45-day credit period.",
  "The purchaser may terminate the Contract in whole or in part at any time and for any reason whatsoever by giving the Vendor at least one month's written notice.",
  "Neither party shall be liable for any failure or delay in performing its obligations under the Contract to the extent that such failure or delay is caused by a Force Majeure Event provided that the Vendor shall use best endeavors to cure such Force Majeure Event and resume performance under the Contract.",
  "The Contract shall be governed by and construed in accordance with the Laws of India.",
  "The parties shall opt for Arbitration as their preferred mode of dispute resolution where in the Legal Manager of the purchaser shall act as the sole arbitrator.",
  "The parties irrevocably submit to the exclusive jurisdiction of the courts of Pune, in case the dispute is not resolved through arbitration and involves litigation.",
  "In the event of the Vendor not signing the supply agreement, the acceptance of this Purchase order shall be deemed to have the same effect as of a valid executed contract.",
];

function fmtDateDMY(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const dd = String(d.getDate()).padStart(2, "0");
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const yy = d.getFullYear();
  return `${dd}-${mm}-${yy}`;
}

function fmtINR(n: number): string {
  return n.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function numToWords(n: number): string {
  const a = ["", "One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight", "Nine", "Ten",
    "Eleven", "Twelve", "Thirteen", "Fourteen", "Fifteen", "Sixteen", "Seventeen", "Eighteen", "Nineteen"];
  const b = ["", "", "Twenty", "Thirty", "Forty", "Fifty", "Sixty", "Seventy", "Eighty", "Ninety"];
  const two = (x: number): string => x < 20 ? a[x] : `${b[Math.floor(x / 10)]}${x % 10 ? " " + a[x % 10] : ""}`;
  const three = (x: number): string => {
    const h = Math.floor(x / 100), r = x % 100;
    return `${h ? a[h] + " Hundred" + (r ? " " : "") : ""}${r ? two(r) : ""}`;
  };
  const rupees = Math.floor(n);
  const paise = Math.round((n - rupees) * 100);
  if (rupees === 0 && paise === 0) return "Zero Rupees";
  const crore = Math.floor(rupees / 10000000);
  const lakh = Math.floor((rupees % 10000000) / 100000);
  const thousand = Math.floor((rupees % 100000) / 1000);
  const rest = rupees % 1000;
  const parts: string[] = [];
  if (crore) parts.push(two(crore) + " Crore");
  if (lakh) parts.push(two(lakh) + " Lakh");
  if (thousand) parts.push(two(thousand) + " Thousand");
  if (rest) parts.push(three(rest));
  let out = parts.join(" ").trim() + " Rupees";
  if (paise) out += " and " + two(paise) + " Paise";
  return out;
}

async function loadLogo(): Promise<string | null> {
  try {
    const res = await fetch(logoUrl);
    const blob = await res.blob();
    return await new Promise((resolve) => {
      const r = new FileReader();
      r.onloadend = () => resolve(r.result as string);
      r.onerror = () => resolve(null);
      r.readAsDataURL(blob);
    });
  } catch {
    return null;
  }
}

export async function generatePOPdf(data: POPdfData): Promise<jsPDF> {
  const doc = new jsPDF({ unit: "pt", format: "a4" });
  const W = doc.internal.pageSize.getWidth();
  const M = 36;
  let y = 36;

  const logo = await loadLogo();
  if (logo) {
    try { doc.addImage(logo, "PNG", M, y, 60, 60); } catch { /* ignore */ }
  }

  // Header — company info centered
  doc.setFont("helvetica", "bold").setFontSize(13);
  doc.text(COMPANY.name, W / 2, y + 14, { align: "center" });
  doc.setFont("helvetica", "normal").setFontSize(9);
  doc.text(COMPANY.address, W / 2, y + 30, { align: "center" });
  doc.text(`Contact No : ${COMPANY.phone}`, W / 2, y + 44, { align: "center" });
  doc.text(`Email : ${COMPANY.email}`, W / 2, y + 56, { align: "center" });

  y += 72;
  doc.setFont("helvetica", "bold").setFontSize(9);
  doc.text(`GSTIN/UIN:${COMPANY.gstin}`, M, y);
  doc.text(`CIN:${COMPANY.cin}`, W - M, y, { align: "right" });

  y += 16;
  doc.setFontSize(13);
  doc.text("PURCHASE ORDER", W / 2, y, { align: "center" });

  // Meta block
  y += 18;
  doc.setFont("helvetica", "normal").setFontSize(10);
  const v = data.vendor;
  const vendorAddress = v
    ? [v.address1, v.address2, [v.city, v.state, v.pincode].filter(Boolean).join(" - "), v.country]
        .filter((s) => s && s.trim()).join(", ")
    : "";

  const leftCol: [string, string][] = [
    [`Date : ${fmtDateDMY(data.po_date)}`, ""],
    [`Vendor ID : ${v?.vendor_code ?? ""}`, ""],
    [`Vendor Name : ${v?.name ?? ""}`, ""],
    [`Vendor GST/UIN : ${v?.gstin ?? ""}`, ""],
  ];
  const rightCol: string[] = [
    `Purchase Order No : ${data.po_number}`,
    `Vendor Phone : ${v?.phone ?? ""}`,
    `Vendor Email : ${v?.email ?? ""}`,
    "",
  ];
  for (let i = 0; i < leftCol.length; i++) {
    doc.text(leftCol[i][0], M, y);
    if (rightCol[i]) doc.text(rightCol[i], W - M, y, { align: "right" });
    y += 14;
  }
  doc.text(`Vendor Address : ${vendorAddress}`, M, y, { maxWidth: W - 2 * M });
  y += 18;
  if (data.ordering_from || data.deliver_to) {
    doc.setFont("helvetica", "bold");
    doc.text(`Ordering From : `, M, y);
    doc.setFont("helvetica", "normal");
    doc.text(data.ordering_from ?? "—", M + 84, y);
    doc.setFont("helvetica", "bold");
    doc.text(`Deliver To : `, W / 2, y);
    doc.setFont("helvetica", "normal");
    doc.text(data.deliver_to ?? "—", W / 2 + 66, y);
    y += 18;
  }
  if (data.remarks && data.remarks.trim()) {
    doc.text(`Remarks : ${data.remarks}`, M, y, { maxWidth: W - 2 * M });
    y += 18;
  }

  // Compute totals
  const lineRows = data.lines.map((l, i) => {
    const total = l.qty * l.unit_price;
    return {
      sl: i + 1,
      code: l.item_code,
      name: l.size_value ? `${l.item_name} ${l.size_value}` : l.item_name,
      unit: l.unit ?? "",
      qty: l.qty,
      price: l.unit_price,
      total,
      tax: l.tax_percent,
    };
  });
  const subtotal = lineRows.reduce((s, r) => s + r.total, 0);
  const subQty = lineRows.reduce((s, r) => s + r.qty, 0);
  const subPrice = lineRows.reduce((s, r) => s + r.price, 0);
  // Use weighted average tax to derive CGST/SGST split
  const totalTax = lineRows.reduce((s, r) => s + r.total * (r.tax / 100), 0);
  const avgTaxPct = subtotal > 0 ? (totalTax / subtotal) * 100 : 0;
  const halfPct = avgTaxPct / 2;
  const cgst = totalTax / 2;
  const sgst = totalTax / 2;
  const grand = subtotal + cgst + sgst;

  autoTable(doc, {
    startY: y,
    margin: { left: M, right: M },
    head: [["SI No", "Code", "Name", "Client", "Quantity", "Purchase Price", "Total Price"]],
    body: [
      ...lineRows.map((r) => [
        r.sl, r.code, r.name, r.unit,
        r.qty.toString(),
        r.price.toFixed(2),
        r.total.toFixed(2),
      ]),
    ],
    foot: [
      [
        { content: "Sub Total", colSpan: 4, styles: { halign: "center", fontStyle: "bold" } },
        { content: subQty.toString(), styles: { halign: "right", fontStyle: "bold" } },
        { content: subPrice.toFixed(2), styles: { halign: "right", fontStyle: "bold" } },
        { content: subtotal.toFixed(2), styles: { halign: "right", fontStyle: "bold" } },
      ],
      [
        { content: `CGST @ ${halfPct.toFixed(2)}%`, colSpan: 5, styles: { halign: "center", fontStyle: "bold" } },
        { content: `Rs. ${fmtINR(cgst)}`, colSpan: 2, styles: { halign: "center", fontStyle: "bold" } },
      ],
      [
        { content: `SGST @ ${halfPct.toFixed(2)}%`, colSpan: 5, styles: { halign: "center", fontStyle: "bold" } },
        { content: `Rs. ${fmtINR(sgst)}`, colSpan: 2, styles: { halign: "center", fontStyle: "bold" } },
      ],
      [
        { content: "Grand Total", colSpan: 5, styles: { halign: "center", fontStyle: "bold" } },
        { content: `Rs. ${fmtINR(grand)}`, colSpan: 2, styles: { halign: "center", fontStyle: "bold" } },
      ],
    ],
    styles: { fontSize: 9, cellPadding: 4, lineColor: [0, 0, 0], lineWidth: 0.5, textColor: [0, 0, 0] },
    headStyles: { fillColor: [255, 255, 255], textColor: [0, 0, 0], fontStyle: "bold", halign: "center", lineWidth: 0.5, lineColor: [0, 0, 0] },
    footStyles: { fillColor: [255, 255, 255], textColor: [0, 0, 0], lineWidth: 0.5, lineColor: [0, 0, 0] },
    columnStyles: {
      0: { halign: "center", cellWidth: 36 },
      1: { halign: "center", cellWidth: 55 },
      2: { halign: "center" },
      3: { halign: "center", cellWidth: 50 },
      4: { halign: "right", cellWidth: 55 },
      5: { halign: "right", cellWidth: 75 },
      6: { halign: "right", cellWidth: 75 },
    },
    theme: "grid",
  });

  // @ts-expect-error - autoTable adds lastAutoTable on doc
  y = (doc.lastAutoTable?.finalY ?? y) + 16;

  doc.setFont("helvetica", "normal").setFontSize(10);
  doc.text("Amount Chargeable ( In Words)", M, y);
  y += 14;
  doc.setFont("helvetica", "bold");
  doc.text(numToWords(grand), M, y, { maxWidth: W - 2 * M });
  y += 36;

  doc.setFont("helvetica", "normal");
  doc.text(`FOR ${COMPANY.name}`, W - M, y, { align: "right" });
  y += 48;
  doc.text("Authorised Signatory", W - M, y, { align: "right" });

  // Terms & conditions on a new page
  doc.addPage();
  let ty = 48;
  doc.setFont("helvetica", "bold").setFontSize(11);
  doc.text("TERMS & CONDITIONS:", M, ty);
  ty += 18;
  doc.setFont("helvetica", "normal").setFontSize(9);
  const pageH = doc.internal.pageSize.getHeight();
  TERMS.forEach((t, i) => {
    const text = `${i + 1}. ${t}`;
    const lines = doc.splitTextToSize(text, W - 2 * M);
    if (ty + lines.length * 12 > pageH - 36) {
      doc.addPage();
      ty = 48;
    }
    doc.text(lines, M, ty);
    ty += lines.length * 12 + 6;
  });

  return doc;
}

export async function downloadPOPdf(data: POPdfData): Promise<void> {
  const doc = await generatePOPdf(data);
  doc.save(`${data.po_number}.pdf`);
}
