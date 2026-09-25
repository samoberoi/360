import { useRef } from "react";
import { Printer } from "lucide-react";
import { Button } from "@/components/ui/button";
import logo from "@/assets/plus-360-fahrenheit-logo.png";

export type TaxInvoiceLine = {
  id: string;
  /** e.g. "Security Guard @ Rs. 151.87 Per Hour for 26 Days For 08 Hrs Duty" */
  description: string;
  hsnSac: string;
  quantityLabel: string;
  rate: number;
  per: string;
  amount: number;
};

export type TaxInvoiceData = {
  invoiceNumber: string;
  invoiceDate: string;
  periodLabel: string;
  company: {
    name: string;
    registeredAddress: string;
    corporateAddress: string;
    gstin: string;
    stateName: string;
    stateCode: string;
    cin: string;
    pan: string;
    email: string;
    phone: string;
    bankName: string;
    bankAccountNo: string;
    bankBranch: string;
    bankIfsc: string;
    supplierType: string;
    msmeUdyamNo: string;
    pfNumber: string;
    esicNumber: string;
    declaration: string;
    note: string;
  };
  party: {
    name: string;
    addressLines: string[];
    gstin: string;
    stateName: string;
    stateCode: string;
  };
  lines: TaxInvoiceLine[];
  totalQuantityLabel: string;
  taxableValue: number;
  cgstRate: number;
  sgstRate: number;
  cgst: number;
  sgst: number;
  igstRate: number;
  igst: number;
  roundingOff: number;
  grandTotal: number;
};

const n2 = (v: number) =>
  v.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** Indian-numbering words used for "Amount Chargeable (in words)". */
export function inrWords(value: number, withPaise = false): string {
  const neg = value < 0;
  const abs = Math.abs(value);
  const rupees = Math.floor(withPaise ? abs : Math.round(abs));
  const paise = Math.round((abs - Math.floor(abs)) * 100);
  const ones = [
    "", "One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight", "Nine", "Ten",
    "Eleven", "Twelve", "Thirteen", "Fourteen", "Fifteen", "Sixteen", "Seventeen", "Eighteen", "Nineteen",
  ];
  const tens = ["", "", "Twenty", "Thirty", "Forty", "Fifty", "Sixty", "Seventy", "Eighty", "Ninety"];
  const two = (x: number): string =>
    x < 20 ? ones[x] : `${tens[Math.floor(x / 10)]}${x % 10 ? ` ${ones[x % 10]}` : ""}`;
  const three = (x: number): string =>
    x >= 100 ? `${ones[Math.floor(x / 100)]} Hundred${x % 100 ? ` ${two(x % 100)}` : ""}` : two(x);
  const words = (x: number): string => {
    if (x === 0) return "Zero";
    const parts: string[] = [];
    const crore = Math.floor(x / 10000000);
    const lakh = Math.floor((x % 10000000) / 100000);
    const thousand = Math.floor((x % 100000) / 1000);
    const rest = x % 1000;
    if (crore) parts.push(`${three(crore)} Crore`);
    if (lakh) parts.push(`${three(lakh)} Lakh`);
    if (thousand) parts.push(`${three(thousand)} Thousand`);
    if (rest) parts.push(three(rest));
    return parts.join(" ");
  };
  const tail = withPaise && paise > 0 ? ` and ${two(paise)} paise` : "";
  return `${neg ? "Minus " : ""}INR ${words(rupees)}${tail} Only`;
}

export function TaxInvoiceSheet({ data }: { data: TaxInvoiceData }) {
  const sheetRef = useRef<HTMLDivElement>(null);

  const print = () => {
    const html = sheetRef.current?.innerHTML;
    if (!html) return;
    const w = window.open("", "_blank", "width=1000,height=1300");
    if (!w) return;
    w.document.write(`<!doctype html><html><head><title>${data.invoiceNumber}</title>
      <style>
        *{box-sizing:border-box;font-family:ui-sans-serif,system-ui,-apple-system,"Segoe UI",sans-serif;}
        body{margin:16px;color:#111;font-size:11px;}
        table{width:100%;border-collapse:collapse;}
        td,th{border:1px solid #999;padding:4px 6px;vertical-align:top;}
        .right{text-align:right;}
        .center{text-align:center;}
        .b{font-weight:700;}
        .muted{color:#555;}
        img{max-height:56px;}
        @page{size:A4;margin:10mm;}
      </style></head><body>${html}</body></html>`);
    w.document.close();
    w.focus();
    w.print();
  };

  const c = data.company;

  return (
    <div className="rounded-3xl border border-border/70 bg-card p-4 shadow-sm sm:p-5">
      <div className="mb-3 grid grid-cols-[minmax(0,1fr)_auto] items-center gap-2">
        <h2 className="text-sm font-semibold uppercase tracking-[0.16em] text-muted-foreground">
          Tax invoice
        </h2>
        <Button size="sm" variant="outline" onClick={print}>
          <Printer className="mr-1.5 h-4 w-4" /> PDF
        </Button>
      </div>

      <div ref={sheetRef} className="overflow-x-auto">
        <div className="mx-auto min-w-[720px] bg-background p-4 text-[11px] leading-snug text-foreground">
          {/* Header */}
          <table className="w-full border border-border">
            <tbody>
              <tr>
                <td className="w-[58%] border border-border p-2 align-top">
                  <div className="flex items-start gap-3">
                    <img src={logo} alt="PLUS 360 FAHRENHEIT SOLUTIONS PVT. LTD." className="h-12 w-28 object-contain" />
                    <div>
                      <div className="text-[13px] font-bold">{c.name}</div>
                      {c.registeredAddress && <div className="muted text-muted-foreground">{c.registeredAddress}</div>}
                      {c.corporateAddress && <div className="muted text-muted-foreground">{c.corporateAddress}</div>}
                      <div>GSTIN/UIN: {c.gstin || "—"}</div>
                      <div>State Name : {c.stateName}, Code : {c.stateCode}</div>
                      {c.cin && <div>CIN: {c.cin}</div>}
                      {c.email && <div>E-Mail : {c.email}</div>}
                      {c.phone && <div>Phone : {c.phone}</div>}
                    </div>
                  </div>
                </td>
                <td className="border border-border p-2 align-top">
                  <div className="grid grid-cols-2 gap-y-1">
                    <div className="text-muted-foreground">Invoice No.</div>
                    <div className="font-semibold">{data.invoiceNumber}</div>
                    <div className="text-muted-foreground">Dated</div>
                    <div className="font-semibold">{data.invoiceDate}</div>
                    <div className="text-muted-foreground">Bill Period</div>
                    <div className="font-semibold">{data.periodLabel}</div>
                  </div>
                  <div className="mt-2 text-center text-[13px] font-bold uppercase tracking-[0.14em]">
                    Tax Invoice
                  </div>
                </td>
              </tr>
              <tr>
                <td className="border border-border p-2 align-top" colSpan={2}>
                  <div className="text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
                    Party
                  </div>
                  <div className="font-semibold">{data.party.name}</div>
                  {data.party.addressLines.filter(Boolean).map((l) => (
                    <div key={l} className="muted text-muted-foreground">{l}</div>
                  ))}
                  <div>GSTIN/UIN : {data.party.gstin || "—"}</div>
                  <div>State Name : {data.party.stateName || "—"}, Code : {data.party.stateCode || "—"}</div>
                </td>
              </tr>
            </tbody>
          </table>

          {/* Lines */}
          <table className="mt-2 w-full border border-border">
            <thead>
              <tr className="bg-secondary/50 text-[10px] uppercase tracking-wider">
                <th className="border border-border px-2 py-1 text-left">Sl No.</th>
                <th className="border border-border px-2 py-1 text-left">Description of Services</th>
                <th className="border border-border px-2 py-1 text-left">HSN/SAC</th>
                <th className="border border-border px-2 py-1 text-right">Quantity</th>
                <th className="border border-border px-2 py-1 text-right">Rate</th>
                <th className="border border-border px-2 py-1 text-left">per</th>
                <th className="border border-border px-2 py-1 text-right">Amount</th>
              </tr>
            </thead>
            <tbody>
              {data.lines.map((l, i) => (
                <tr key={l.id}>
                  <td className="border border-border px-2 py-1">{i + 1}</td>
                  <td className="border border-border px-2 py-1">{l.description}</td>
                  <td className="border border-border px-2 py-1">{l.hsnSac}</td>
                  <td className="border border-border px-2 py-1 text-right tabular-nums">{l.quantityLabel}</td>
                  <td className="border border-border px-2 py-1 text-right tabular-nums">{n2(l.rate)}</td>
                  <td className="border border-border px-2 py-1">{l.per}</td>
                  <td className="border border-border px-2 py-1 text-right tabular-nums">{n2(l.amount)}</td>
                </tr>
              ))}
              {data.igst > 0 ? (
                <tr>
                  <td className="border border-border px-2 py-1" />
                  <td className="border border-border px-2 py-1">IGST @ {data.igstRate}%</td>
                  <td className="border border-border px-2 py-1" colSpan={4} />
                  <td className="border border-border px-2 py-1 text-right tabular-nums">{n2(data.igst)}</td>
                </tr>
              ) : <>
                <tr>
                  <td className="border border-border px-2 py-1" />
                  <td className="border border-border px-2 py-1">CGST @ {data.cgstRate}%</td>
                  <td className="border border-border px-2 py-1" colSpan={4} />
                  <td className="border border-border px-2 py-1 text-right tabular-nums">{n2(data.cgst)}</td>
                </tr>
                <tr>
                  <td className="border border-border px-2 py-1" />
                  <td className="border border-border px-2 py-1">SGST @ {data.sgstRate}%</td>
                  <td className="border border-border px-2 py-1" colSpan={4} />
                  <td className="border border-border px-2 py-1 text-right tabular-nums">{n2(data.sgst)}</td>
                </tr>
              </>}
              {Math.abs(data.roundingOff) >= 0.005 && (
                <tr>
                  <td className="border border-border px-2 py-1" />
                  <td className="border border-border px-2 py-1">Rounding Off</td>
                  <td className="border border-border px-2 py-1" colSpan={4} />
                  <td className="border border-border px-2 py-1 text-right tabular-nums">{n2(data.roundingOff)}</td>
                </tr>
              )}
              <tr className="font-semibold">
                <td className="border border-border px-2 py-1" />
                <td className="border border-border px-2 py-1">Total</td>
                <td className="border border-border px-2 py-1" />
                <td className="border border-border px-2 py-1 text-right tabular-nums">{data.totalQuantityLabel}</td>
                <td className="border border-border px-2 py-1" colSpan={2} />
                <td className="border border-border px-2 py-1 text-right tabular-nums">₹ {n2(data.grandTotal)}</td>
              </tr>
            </tbody>
          </table>

          <div className="mt-2 border border-border p-2">
            <span className="text-muted-foreground">Amount Chargeable (in words): </span>
            <span className="font-semibold">{inrWords(data.grandTotal)}</span>
            <span className="float-right text-muted-foreground">E. &amp; O.E</span>
          </div>

          {/* HSN summary */}
          <table className="mt-2 w-full border border-border">
            <thead>
              <tr className="bg-secondary/50 text-[10px] uppercase tracking-wider">
                <th className="border border-border px-2 py-1 text-left">HSN/SAC</th>
                <th className="border border-border px-2 py-1 text-right">Taxable Value</th>
                <th className="border border-border px-2 py-1 text-right">{data.igst > 0 ? "IGST Rate" : "CGST Rate"}</th>
                <th className="border border-border px-2 py-1 text-right">{data.igst > 0 ? "IGST Amount" : "CGST Amount"}</th>
                <th className="border border-border px-2 py-1 text-right">{data.igst > 0 ? "" : "SGST Rate"}</th>
                <th className="border border-border px-2 py-1 text-right">{data.igst > 0 ? "" : "SGST Amount"}</th>
                <th className="border border-border px-2 py-1 text-right">Total Tax Amount</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td className="border border-border px-2 py-1">{data.lines[0]?.hsnSac ?? "—"}</td>
                <td className="border border-border px-2 py-1 text-right tabular-nums">{n2(data.taxableValue)}</td>
                <td className="border border-border px-2 py-1 text-right">{data.igst > 0 ? data.igstRate : data.cgstRate}%</td>
                <td className="border border-border px-2 py-1 text-right tabular-nums">{n2(data.igst > 0 ? data.igst : data.cgst)}</td>
                <td className="border border-border px-2 py-1 text-right">{data.igst > 0 ? "" : `${data.sgstRate}%`}</td>
                <td className="border border-border px-2 py-1 text-right tabular-nums">{data.igst > 0 ? "" : n2(data.sgst)}</td>
                <td className="border border-border px-2 py-1 text-right tabular-nums">
                  {n2(data.cgst + data.sgst + data.igst)}
                </td>
              </tr>
              <tr className="font-semibold">
                <td className="border border-border px-2 py-1">Total</td>
                <td className="border border-border px-2 py-1 text-right tabular-nums">{n2(data.taxableValue)}</td>
                <td className="border border-border px-2 py-1" />
                <td className="border border-border px-2 py-1 text-right tabular-nums">{n2(data.igst > 0 ? data.igst : data.cgst)}</td>
                <td className="border border-border px-2 py-1" />
                <td className="border border-border px-2 py-1 text-right tabular-nums">{data.igst > 0 ? "" : n2(data.sgst)}</td>
                <td className="border border-border px-2 py-1 text-right tabular-nums">
                  {n2(data.cgst + data.sgst + data.igst)}
                </td>
              </tr>
            </tbody>
          </table>


          <div className="mt-2 border border-border p-2">
            <span className="text-muted-foreground">Tax Amount (in words) : </span>
            <span className="font-semibold">{inrWords(data.cgst + data.sgst + data.igst, true)}</span>
          </div>

          {/* Footer */}
          <table className="mt-2 w-full border border-border">
            <tbody>
              <tr>
                <td className="w-1/2 border border-border p-2 align-top">
                  <div className="text-muted-foreground">Remarks:</div>
                  <div>Bill Period - {data.periodLabel}</div>
                  <div className="mt-2 font-semibold">Company&apos;s Bank Details</div>
                  {c.pan && <div>Company&apos;s PAN : {c.pan}</div>}
                  {c.bankName && (
                    <div>
                      Bank Name : {c.bankName}
                      {c.bankAccountNo ? ` A/C NO. ${c.bankAccountNo}` : ""}
                    </div>
                  )}
                  {c.bankAccountNo && <div>A/c No. : {c.bankAccountNo}</div>}

                  {(c.bankBranch || c.bankIfsc) && (
                    <div>Branch &amp; IFS Code : {[c.bankBranch, c.bankIfsc].filter(Boolean).join(" & ")}</div>
                  )}
                  <div className="mt-2">
                    {c.supplierType && <div>Supplier Type: {c.supplierType}</div>}
                    {c.msmeUdyamNo && <div>Udyam Registration No: {c.msmeUdyamNo}</div>}
                    {c.cin && <div>CIN No : {c.cin}</div>}
                    {c.pfNumber && <div>PF No: {c.pfNumber}</div>}
                    {c.esicNumber && <div>ESIC No: {c.esicNumber}</div>}
                  </div>
                </td>
                <td className="border border-border p-2 align-top">
                  <div className="font-semibold">Declaration</div>
                  {c.declaration && <div className="muted text-muted-foreground">&quot;{c.declaration}&quot;</div>}
                  {c.note && <div className="muted mt-1 text-muted-foreground">Note: &quot;{c.note}&quot;</div>}
                  <div className="mt-8 text-right">
                    <div>for {c.name}</div>
                    <div className="mt-8">Authorised Signatory</div>
                  </div>
                </td>
              </tr>
            </tbody>
          </table>

          <div className="mt-1 text-center text-[10px] text-muted-foreground">
            This is a Computer Generated Invoice
          </div>
        </div>
      </div>
    </div>
  );
}
