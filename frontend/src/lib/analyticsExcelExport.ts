import XLSX from "xlsx-js-style";
import { format } from "date-fns";
import { supabase } from "@/integrations/supabase/client";

type DateRange = { from: Date; to: Date };

// -------- Styling helpers --------
const FONT = "Calibri";
const BRAND = "D95D4E"; // coral brand
const HEADER_BG = "1F2937"; // slate-800
const ALT_ROW_BG = "F8FAFC";
const TOTAL_BG = "FEE2E2";

const titleStyle = {
  font: { name: FONT, sz: 18, bold: true, color: { rgb: "FFFFFF" } },
  fill: { fgColor: { rgb: BRAND } },
  alignment: { horizontal: "center", vertical: "center" },
};

const subTitleStyle = {
  font: { name: FONT, sz: 11, italic: true, color: { rgb: "374151" } },
  alignment: { horizontal: "center", vertical: "center" },
};

const headerStyle = {
  font: { name: FONT, sz: 11, bold: true, color: { rgb: "FFFFFF" } },
  fill: { fgColor: { rgb: HEADER_BG } },
  alignment: { horizontal: "center", vertical: "center", wrapText: true },
  border: {
    top: { style: "thin", color: { rgb: "CBD5E1" } },
    bottom: { style: "thin", color: { rgb: "CBD5E1" } },
    left: { style: "thin", color: { rgb: "CBD5E1" } },
    right: { style: "thin", color: { rgb: "CBD5E1" } },
  },
};

const cellStyle = (alt: boolean, opts: { bold?: boolean; numFmt?: string; align?: string } = {}) => ({
  font: { name: FONT, sz: 10, bold: !!opts.bold, color: { rgb: "111827" } },
  fill: { fgColor: { rgb: alt ? ALT_ROW_BG : "FFFFFF" } },
  alignment: { horizontal: opts.align || "left", vertical: "center" },
  border: {
    top: { style: "hair", color: { rgb: "E5E7EB" } },
    bottom: { style: "hair", color: { rgb: "E5E7EB" } },
    left: { style: "hair", color: { rgb: "E5E7EB" } },
    right: { style: "hair", color: { rgb: "E5E7EB" } },
  },
  numFmt: opts.numFmt,
});

const totalStyle = (opts: { numFmt?: string; align?: string } = {}) => ({
  font: { name: FONT, sz: 11, bold: true, color: { rgb: "7F1D1D" } },
  fill: { fgColor: { rgb: TOTAL_BG } },
  alignment: { horizontal: opts.align || "left", vertical: "center" },
  border: {
    top: { style: "medium", color: { rgb: BRAND } },
    bottom: { style: "medium", color: { rgb: BRAND } },
    left: { style: "thin", color: { rgb: BRAND } },
    right: { style: "thin", color: { rgb: BRAND } },
  },
  numFmt: opts.numFmt,
});

const NUM_CURRENCY = '"$"#,##0.00;[Red]("$"#,##0.00);"-"';
const NUM_INT = "#,##0;[Red](#,##0);-";
const NUM_PCT = "0.0%;[Red](0.0%);-";

type Col = {
  header: string;
  key: string;
  width?: number;
  type?: "currency" | "int" | "pct" | "text";
  align?: string;
};

function buildSheet(title: string, subtitle: string, columns: Col[], rows: any[], totalRow?: Record<string, any>) {
  const ws: XLSX.WorkSheet = {};
  const ncols = columns.length;
  const lastCol = XLSX.utils.encode_col(ncols - 1);

  // Row 1: Title (merged)
  ws["A1"] = { v: title, s: titleStyle, t: "s" };
  // Row 2: Subtitle (merged)
  ws["A2"] = { v: subtitle, s: subTitleStyle, t: "s" };
  // Row 3: empty spacer

  const headerRow = 4;
  columns.forEach((c, ci) => {
    const addr = XLSX.utils.encode_cell({ r: headerRow - 1, c: ci });
    ws[addr] = { v: c.header, s: headerStyle, t: "s" };
  });

  rows.forEach((row, ri) => {
    const alt = ri % 2 === 1;
    columns.forEach((c, ci) => {
      const addr = XLSX.utils.encode_cell({ r: headerRow + ri, c: ci });
      const val = row[c.key];
      const numFmt =
        c.type === "currency" ? NUM_CURRENCY : c.type === "int" ? NUM_INT : c.type === "pct" ? NUM_PCT : undefined;
      const align = c.align || (c.type && c.type !== "text" ? "right" : "left");
      const isNumeric = c.type === "currency" || c.type === "int" || c.type === "pct";
      ws[addr] = {
        v: val == null ? "" : val,
        t: isNumeric && typeof val === "number" ? "n" : "s",
        s: cellStyle(alt, { numFmt, align }),
      };
    });
  });

  if (totalRow) {
    const r = headerRow + rows.length;
    columns.forEach((c, ci) => {
      const addr = XLSX.utils.encode_cell({ r, c: ci });
      const val = totalRow[c.key];
      const numFmt =
        c.type === "currency" ? NUM_CURRENCY : c.type === "int" ? NUM_INT : c.type === "pct" ? NUM_PCT : undefined;
      const align = c.align || (c.type && c.type !== "text" ? "right" : "left");
      const isNumeric = c.type === "currency" || c.type === "int" || c.type === "pct";
      ws[addr] = {
        v: val == null ? "" : val,
        t: isNumeric && typeof val === "number" ? "n" : "s",
        s: totalStyle({ numFmt, align }),
      };
    });
  }

  const endRow = headerRow + rows.length + (totalRow ? 1 : 0);
  ws["!ref"] = `A1:${lastCol}${endRow}`;
  ws["!merges"] = [
    { s: { r: 0, c: 0 }, e: { r: 0, c: ncols - 1 } },
    { s: { r: 1, c: 0 }, e: { r: 1, c: ncols - 1 } },
  ];
  ws["!cols"] = columns.map((c) => ({ wch: c.width || 18 }));
  ws["!rows"] = [{ hpt: 28 }, { hpt: 18 }, { hpt: 6 }, { hpt: 22 }];
  return ws;
}

// -------- Data fetchers --------
async function fetchAll<T = any>(
  table: string,
  build: (q: any) => any,
  pageSize = 1000
): Promise<T[]> {
  const all: T[] = [];
  for (let offset = 0; ; offset += pageSize) {
    const q = build(supabase.from(table as any).select("*"));
    const { data, error } = await q.range(offset, offset + pageSize - 1);
    if (error) throw error;
    if (!data || data.length === 0) break;
    all.push(...(data as T[]));
    if (data.length < pageSize) break;
  }
  return all;
}

async function fetchInvoiceItems(invoiceIds: string[]) {
  if (invoiceIds.length === 0) return [] as any[];
  const ID_CHUNK = 100;
  const PAGE = 1000;
  const all: any[] = [];
  for (let i = 0; i < invoiceIds.length; i += ID_CHUNK) {
    const chunk = invoiceIds.slice(i, i + ID_CHUNK);
    for (let offset = 0; ; offset += PAGE) {
      const { data, error } = await supabase
        .from("invoice_items")
        .select("invoice_id, product_id, product_name, quantity, subtotal, unit_price")
        .in("invoice_id", chunk)
        .range(offset, offset + PAGE - 1);
      if (error) throw error;
      if (!data || data.length === 0) break;
      all.push(...data);
      if (data.length < PAGE) break;
    }
  }
  return all;
}

// Format a Date as a local YYYY-MM-DD calendar string (no timezone shift).
const toLocalDateStr = (d: Date) => {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
};

// -------- Main export --------
export async function exportAnalyticsToExcel(range: DateRange) {
  // Treat the user's selected dates as calendar dates in their LOCAL timezone.
  // Build full-day boundaries in local time, then convert to absolute ISO
  // instants for the DB query. Grouping below uses the same local date so
  // an invoice counted in the range is attributed to the same day shown.
  const fromDate = new Date(range.from.getFullYear(), range.from.getMonth(), range.from.getDate(), 0, 0, 0, 0);
  const toDate = new Date(range.to.getFullYear(), range.to.getMonth(), range.to.getDate(), 23, 59, 59, 999);
  const fromISO = fromDate.toISOString();
  const toISO = toDate.toISOString();
  const fromKey = toLocalDateStr(fromDate);
  const toKey = toLocalDateStr(toDate);


  // Fetch invoices (exclude frozen shops)
  const invoices: any[] = [];
  {
    const PAGE = 1000;
    for (let offset = 0; ; offset += PAGE) {
      const { data, error } = await supabase
        .from("invoices")
        .select("id, total_amount, discount_amount, payment_status, shop_id, created_at, created_by, shops!inner(id, is_frozen)")
        .eq("shops.is_frozen", false)
        .gte("created_at", fromISO)
        .lte("created_at", toISO)
        .order("created_at", { ascending: true })
        .range(offset, offset + PAGE - 1);
      if (error) throw error;
      if (!data || data.length === 0) break;
      invoices.push(...data);
      if (data.length < PAGE) break;
    }
  }

  // Safety net: drop anything whose LOCAL calendar date falls outside the
  // user's selected range. Postgres compares the timestamptz as an absolute
  // instant, which can leak in records right at midnight boundaries when the
  // user's timezone differs from UTC. Filtering by the same local date key we
  // use for grouping guarantees the totals match the per-day breakdown.
  for (let i = invoices.length - 1; i >= 0; i--) {
    const k = toLocalDateStr(new Date(invoices[i].created_at));
    if (k < fromKey || k > toKey) invoices.splice(i, 1);
  }


  // Payments
  const payments: any[] = [];
  {
    const PAGE = 1000;
    for (let offset = 0; ; offset += PAGE) {
      const { data, error } = await supabase
        .from("payments")
        .select("id, amount, payment_method, payment_date, invoice_id")
        .gte("payment_date", fromISO)
        .lte("payment_date", toISO)
        .range(offset, offset + PAGE - 1);
      if (error) throw error;
      if (!data || data.length === 0) break;
      payments.push(...data);
      if (data.length < PAGE) break;
    }
  }
  for (let i = payments.length - 1; i >= 0; i--) {
    const k = toLocalDateStr(new Date(payments[i].payment_date));
    if (k < fromKey || k > toKey) payments.splice(i, 1);
  }


  const items = await fetchInvoiceItems(invoices.map((i) => i.id));

  const [{ data: products }, { data: shops }, { data: profiles }] = await Promise.all([
    supabase.from("products").select("id, name, category, subcategory, sub_subcategory"),
    supabase.from("shops").select("id, name, owner_name, phone, street_address, street_address_line_2, city, state, zip_code, is_frozen"),
    supabase.from("profiles").select("id, full_name"),
  ]);

  const productMap = new Map<string, any>((products || []).map((p: any) => [p.id, p]));
  const shopMap = new Map<string, any>((shops || []).map((s: any) => [s.id, s]));
  const profileMap = new Map<string, string>((profiles || []).map((p: any) => [p.id, p.full_name]));

  const totalRevenue = invoices.reduce((s, i) => s + Number(i.total_amount || 0), 0);
  const totalCollected = payments.reduce((s, p) => s + Number(p.amount || 0), 0);
  const totalQty = items.reduce((s: number, it: any) => s + Number(it.quantity || 0), 0);

  // --- Summary sheet ---
  const summaryRows = [
    { label: "Period Start", value: format(range.from, "MMMM d, yyyy") },
    { label: "Period End", value: format(range.to, "MMMM d, yyyy") },
    { label: "Days in Period", value: Math.max(1, Math.round((range.to.getTime() - range.from.getTime()) / 86400000) + 1) },
    { label: "Total Invoices", value: invoices.length },
    { label: "Total Revenue", value: totalRevenue, fmt: NUM_CURRENCY },
    { label: "Total Collected", value: totalCollected, fmt: NUM_CURRENCY },
    { label: "Outstanding Balance", value: totalRevenue - totalCollected, fmt: NUM_CURRENCY },
    { label: "Collection Rate", value: totalRevenue > 0 ? totalCollected / totalRevenue : 0, fmt: NUM_PCT },
    { label: "Units Sold", value: totalQty, fmt: NUM_INT },
    { label: "Unique Shops", value: new Set(invoices.map((i) => i.shop_id)).size },
    { label: "Unique Products Sold", value: new Set(items.map((it: any) => it.product_id)).size },
    { label: "Avg Invoice Value", value: invoices.length ? totalRevenue / invoices.length : 0, fmt: NUM_CURRENCY },
  ];

  const wsSummary: XLSX.WorkSheet = {};
  wsSummary["A1"] = { v: "MR FOG — Analytics Report", s: titleStyle, t: "s" };
  wsSummary["A2"] = {
    v: `${format(range.from, "MMM d, yyyy")} – ${format(range.to, "MMM d, yyyy")}`,
    s: subTitleStyle,
    t: "s",
  };
  wsSummary["A4"] = { v: "Metric", s: headerStyle, t: "s" };
  wsSummary["B4"] = { v: "Value", s: headerStyle, t: "s" };
  summaryRows.forEach((r, i) => {
    const row = 5 + i;
    wsSummary[`A${row}`] = { v: r.label, s: cellStyle(i % 2 === 1, { bold: true }), t: "s" };
    const isNum = typeof r.value === "number";
    wsSummary[`B${row}`] = {
      v: r.value,
      t: isNum ? "n" : "s",
      s: cellStyle(i % 2 === 1, { numFmt: r.fmt, align: "right" }),
    };
  });
  wsSummary["!ref"] = `A1:B${4 + summaryRows.length}`;
  wsSummary["!merges"] = [
    { s: { r: 0, c: 0 }, e: { r: 0, c: 1 } },
    { s: { r: 1, c: 0 }, e: { r: 1, c: 1 } },
  ];
  wsSummary["!cols"] = [{ wch: 28 }, { wch: 22 }];
  wsSummary["!rows"] = [{ hpt: 30 }, { hpt: 20 }, { hpt: 6 }, { hpt: 22 }];

  // --- Top Shops by Revenue with Locations ---
  const shopAgg = new Map<string, any>();
  invoices.forEach((i) => {
    const shop = shopMap.get(i.shop_id);
    if (!shop) return;
    const cur = shopAgg.get(i.shop_id) || {
      name: shop.name,
      owner: shop.owner_name || "",
      phone: shop.phone || "",
      address: [shop.street_address, shop.street_address_line_2].filter(Boolean).join(", "),
      city: shop.city || "",
      state: shop.state || "",
      zip: shop.zip_code || "",
      invoices: 0,
      revenue: 0,
    };
    cur.invoices += 1;
    cur.revenue += Number(i.total_amount || 0);
    shopAgg.set(i.shop_id, cur);
  });
  const topShops = Array.from(shopAgg.values()).sort((a, b) => b.revenue - a.revenue);
  const topShopsRows = topShops.map((s, i) => ({
    rank: i + 1,
    ...s,
    share: totalRevenue > 0 ? s.revenue / totalRevenue : 0,
  }));

  const wsShops = buildSheet(
    "Top Shops by Revenue (with Locations)",
    `${format(range.from, "MMM d, yyyy")} – ${format(range.to, "MMM d, yyyy")}`,
    [
      { header: "#", key: "rank", width: 6, type: "int" },
      { header: "Shop Name", key: "name", width: 30 },
      { header: "Owner", key: "owner", width: 20 },
      { header: "Phone", key: "phone", width: 16 },
      { header: "Address", key: "address", width: 32 },
      { header: "City", key: "city", width: 16 },
      { header: "State", key: "state", width: 10 },
      { header: "Zip", key: "zip", width: 10 },
      { header: "Invoices", key: "invoices", width: 10, type: "int" },
      { header: "Revenue", key: "revenue", width: 16, type: "currency" },
      { header: "% of Total", key: "share", width: 12, type: "pct" },
    ],
    topShopsRows,
    {
      rank: "TOTAL",
      name: "",
      owner: "",
      phone: "",
      address: "",
      city: "",
      state: "",
      zip: "",
      invoices: invoices.length,
      revenue: totalRevenue,
      share: 1,
    },
  );

  // --- Top Products by Quantity Sold ---
  const productAgg = new Map<string, any>();
  items.forEach((it: any) => {
    const prod = productMap.get(it.product_id);
    const key = it.product_id || it.product_name;
    const cur = productAgg.get(key) || {
      name: it.product_name,
      category: prod?.category || "Uncategorized",
      subcategory: prod?.subcategory || "",
      sub_subcategory: prod?.sub_subcategory || "",
      quantity: 0,
      revenue: 0,
    };
    cur.quantity += Number(it.quantity || 0);
    cur.revenue += Number(it.subtotal || 0);
    productAgg.set(key, cur);
  });
  const topProductsRows = Array.from(productAgg.values())
    .sort((a, b) => b.quantity - a.quantity)
    .map((p, i) => ({
      rank: i + 1,
      ...p,
      share_qty: totalQty > 0 ? p.quantity / totalQty : 0,
      share_rev: totalRevenue > 0 ? p.revenue / totalRevenue : 0,
    }));

  const wsProducts = buildSheet(
    "Top Products by Quantity Sold",
    `${format(range.from, "MMM d, yyyy")} – ${format(range.to, "MMM d, yyyy")}`,
    [
      { header: "#", key: "rank", width: 6, type: "int" },
      { header: "Product", key: "name", width: 32 },
      { header: "Category", key: "category", width: 18 },
      { header: "Sub-Category", key: "subcategory", width: 18 },
      { header: "Sub-Sub-Category", key: "sub_subcategory", width: 20 },
      { header: "Qty Sold", key: "quantity", width: 12, type: "int" },
      { header: "% of Qty", key: "share_qty", width: 10, type: "pct" },
      { header: "Revenue", key: "revenue", width: 16, type: "currency" },
      { header: "% of Revenue", key: "share_rev", width: 12, type: "pct" },
    ],
    topProductsRows,
    {
      rank: "TOTAL",
      name: "",
      category: "",
      subcategory: "",
      sub_subcategory: "",
      quantity: totalQty,
      share_qty: 1,
      revenue: totalRevenue,
      share_rev: 1,
    },
  );

  // --- Sales by Category ---
  const catAgg = new Map<string, any>();
  items.forEach((it: any) => {
    const prod = productMap.get(it.product_id);
    const cat = prod?.category || "Uncategorized";
    const cur = catAgg.get(cat) || { category: cat, quantity: 0, revenue: 0 };
    cur.quantity += Number(it.quantity || 0);
    cur.revenue += Number(it.subtotal || 0);
    catAgg.set(cat, cur);
  });
  const catRows = Array.from(catAgg.values())
    .sort((a, b) => b.revenue - a.revenue)
    .map((c) => ({ ...c, share: totalRevenue > 0 ? c.revenue / totalRevenue : 0 }));

  const wsCat = buildSheet(
    "Sales by Category",
    `${format(range.from, "MMM d, yyyy")} – ${format(range.to, "MMM d, yyyy")}`,
    [
      { header: "Category", key: "category", width: 24 },
      { header: "Qty Sold", key: "quantity", width: 12, type: "int" },
      { header: "Revenue", key: "revenue", width: 16, type: "currency" },
      { header: "% of Revenue", key: "share", width: 14, type: "pct" },
    ],
    catRows,
    { category: "TOTAL", quantity: totalQty, revenue: totalRevenue, share: 1 },
  );

  // --- Sales by Sub-Category ---
  const subAgg = new Map<string, any>();
  items.forEach((it: any) => {
    const prod = productMap.get(it.product_id);
    const cat = prod?.category || "Uncategorized";
    const sub = prod?.subcategory || "(none)";
    const key = `${cat}||${sub}`;
    const cur = subAgg.get(key) || { category: cat, subcategory: sub, quantity: 0, revenue: 0 };
    cur.quantity += Number(it.quantity || 0);
    cur.revenue += Number(it.subtotal || 0);
    subAgg.set(key, cur);
  });
  const subRows = Array.from(subAgg.values())
    .sort((a, b) => b.revenue - a.revenue)
    .map((s) => ({ ...s, share: totalRevenue > 0 ? s.revenue / totalRevenue : 0 }));

  const wsSub = buildSheet(
    "Sales by Sub-Category",
    `${format(range.from, "MMM d, yyyy")} – ${format(range.to, "MMM d, yyyy")}`,
    [
      { header: "Category", key: "category", width: 22 },
      { header: "Sub-Category", key: "subcategory", width: 24 },
      { header: "Qty Sold", key: "quantity", width: 12, type: "int" },
      { header: "Revenue", key: "revenue", width: 16, type: "currency" },
      { header: "% of Revenue", key: "share", width: 14, type: "pct" },
    ],
    subRows,
    { category: "TOTAL", subcategory: "", quantity: totalQty, revenue: totalRevenue, share: 1 },
  );

  // --- Sales by Sub-Sub-Category ---
  const subsubAgg = new Map<string, any>();
  items.forEach((it: any) => {
    const prod = productMap.get(it.product_id);
    const cat = prod?.category || "Uncategorized";
    const sub = prod?.subcategory || "(none)";
    const subsub = prod?.sub_subcategory || "(none)";
    const key = `${cat}||${sub}||${subsub}`;
    const cur = subsubAgg.get(key) || { category: cat, subcategory: sub, sub_subcategory: subsub, quantity: 0, revenue: 0 };
    cur.quantity += Number(it.quantity || 0);
    cur.revenue += Number(it.subtotal || 0);
    subsubAgg.set(key, cur);
  });
  const subsubRows = Array.from(subsubAgg.values())
    .sort((a, b) => b.revenue - a.revenue)
    .map((s) => ({ ...s, share: totalRevenue > 0 ? s.revenue / totalRevenue : 0 }));

  const wsSubSub = buildSheet(
    "Sales by Sub-Sub-Category",
    `${format(range.from, "MMM d, yyyy")} – ${format(range.to, "MMM d, yyyy")}`,
    [
      { header: "Category", key: "category", width: 18 },
      { header: "Sub-Category", key: "subcategory", width: 20 },
      { header: "Sub-Sub-Category", key: "sub_subcategory", width: 22 },
      { header: "Qty Sold", key: "quantity", width: 12, type: "int" },
      { header: "Revenue", key: "revenue", width: 16, type: "currency" },
      { header: "% of Revenue", key: "share", width: 14, type: "pct" },
    ],
    subsubRows,
    { category: "TOTAL", subcategory: "", sub_subcategory: "", quantity: totalQty, revenue: totalRevenue, share: 1 },
  );

  // --- Sales by Region (City + State) ---
  const regionAgg = new Map<string, any>();
  invoices.forEach((i) => {
    const shop = shopMap.get(i.shop_id);
    if (!shop) return;
    const city = shop.city || "Unknown";
    const state = shop.state || "Unknown";
    const key = `${city}||${state}`;
    const cur = regionAgg.get(key) || { city, state, shops: new Set<string>(), invoices: 0, revenue: 0 };
    cur.shops.add(i.shop_id);
    cur.invoices += 1;
    cur.revenue += Number(i.total_amount || 0);
    regionAgg.set(key, cur);
  });
  const regionRows = Array.from(regionAgg.values())
    .map((r) => ({
      city: r.city,
      state: r.state,
      shops: r.shops.size,
      invoices: r.invoices,
      revenue: r.revenue,
      share: totalRevenue > 0 ? r.revenue / totalRevenue : 0,
    }))
    .sort((a, b) => b.revenue - a.revenue);

  const wsRegion = buildSheet(
    "Sales by Region (% Buying Areas)",
    `${format(range.from, "MMM d, yyyy")} – ${format(range.to, "MMM d, yyyy")}`,
    [
      { header: "City", key: "city", width: 22 },
      { header: "State", key: "state", width: 12 },
      { header: "Shops", key: "shops", width: 10, type: "int" },
      { header: "Invoices", key: "invoices", width: 10, type: "int" },
      { header: "Revenue", key: "revenue", width: 16, type: "currency" },
      { header: "% of Revenue", key: "share", width: 14, type: "pct" },
    ],
    regionRows,
    {
      city: "TOTAL",
      state: "",
      shops: new Set(invoices.map((i) => i.shop_id)).size,
      invoices: invoices.length,
      revenue: totalRevenue,
      share: 1,
    },
  );

  // --- Sales by State (rollup) ---
  const stateAgg = new Map<string, any>();
  invoices.forEach((i) => {
    const shop = shopMap.get(i.shop_id);
    if (!shop) return;
    const state = shop.state || "Unknown";
    const cur = stateAgg.get(state) || { state, shops: new Set<string>(), invoices: 0, revenue: 0 };
    cur.shops.add(i.shop_id);
    cur.invoices += 1;
    cur.revenue += Number(i.total_amount || 0);
    stateAgg.set(state, cur);
  });
  const stateRows = Array.from(stateAgg.values())
    .map((r) => ({
      state: r.state,
      shops: r.shops.size,
      invoices: r.invoices,
      revenue: r.revenue,
      share: totalRevenue > 0 ? r.revenue / totalRevenue : 0,
    }))
    .sort((a, b) => b.revenue - a.revenue);

  const wsState = buildSheet(
    "Sales by State",
    `${format(range.from, "MMM d, yyyy")} – ${format(range.to, "MMM d, yyyy")}`,
    [
      { header: "State", key: "state", width: 14 },
      { header: "Shops", key: "shops", width: 10, type: "int" },
      { header: "Invoices", key: "invoices", width: 10, type: "int" },
      { header: "Revenue", key: "revenue", width: 16, type: "currency" },
      { header: "% of Revenue", key: "share", width: 14, type: "pct" },
    ],
    stateRows,
    {
      state: "TOTAL",
      shops: new Set(invoices.map((i) => i.shop_id)).size,
      invoices: invoices.length,
      revenue: totalRevenue,
      share: 1,
    },
  );

  // --- Daily sales ---
  const dayAgg = new Map<string, any>();
  invoices.forEach((i) => {
    const key = format(new Date(i.created_at), "yyyy-MM-dd");
    const cur = dayAgg.get(key) || { date: key, invoices: 0, revenue: 0 };
    cur.invoices += 1;
    cur.revenue += Number(i.total_amount || 0);
    dayAgg.set(key, cur);
  });
  const dayRows = Array.from(dayAgg.values()).sort((a, b) => a.date.localeCompare(b.date));
  const wsDay = buildSheet(
    "Sales by Day",
    `${format(range.from, "MMM d, yyyy")} – ${format(range.to, "MMM d, yyyy")}`,
    [
      { header: "Date", key: "date", width: 14 },
      { header: "Invoices", key: "invoices", width: 12, type: "int" },
      { header: "Revenue", key: "revenue", width: 16, type: "currency" },
    ],
    dayRows,
    { date: "TOTAL", invoices: invoices.length, revenue: totalRevenue },
  );

  // --- Monthly sales ---
  const monAgg = new Map<string, any>();
  invoices.forEach((i) => {
    const key = format(new Date(i.created_at), "yyyy-MM");
    const cur = monAgg.get(key) || { month: key, invoices: 0, revenue: 0 };
    cur.invoices += 1;
    cur.revenue += Number(i.total_amount || 0);
    monAgg.set(key, cur);
  });
  const monRows = Array.from(monAgg.values())
    .sort((a, b) => a.month.localeCompare(b.month))
    .map((m) => ({
      month: format(new Date(m.month + "-01"), "MMMM yyyy"),
      invoices: m.invoices,
      revenue: m.revenue,
    }));
  const wsMon = buildSheet(
    "Sales by Month",
    `${format(range.from, "MMM d, yyyy")} – ${format(range.to, "MMM d, yyyy")}`,
    [
      { header: "Month", key: "month", width: 20 },
      { header: "Invoices", key: "invoices", width: 12, type: "int" },
      { header: "Revenue", key: "revenue", width: 16, type: "currency" },
    ],
    monRows,
    { month: "TOTAL", invoices: invoices.length, revenue: totalRevenue },
  );

  // --- Sales by Staff ---
  const staffAgg = new Map<string, any>();
  invoices.forEach((i) => {
    const name = profileMap.get(i.created_by) || "Unknown";
    const cur = staffAgg.get(name) || { name, invoices: 0, revenue: 0 };
    cur.invoices += 1;
    cur.revenue += Number(i.total_amount || 0);
    staffAgg.set(name, cur);
  });
  const staffRows = Array.from(staffAgg.values())
    .sort((a, b) => b.revenue - a.revenue)
    .map((s) => ({ ...s, share: totalRevenue > 0 ? s.revenue / totalRevenue : 0 }));
  const wsStaff = buildSheet(
    "Sales by Staff",
    `${format(range.from, "MMM d, yyyy")} – ${format(range.to, "MMM d, yyyy")}`,
    [
      { header: "Staff", key: "name", width: 24 },
      { header: "Invoices", key: "invoices", width: 12, type: "int" },
      { header: "Revenue", key: "revenue", width: 16, type: "currency" },
      { header: "% of Revenue", key: "share", width: 14, type: "pct" },
    ],
    staffRows,
    { name: "TOTAL", invoices: invoices.length, revenue: totalRevenue, share: 1 },
  );

  // --- Payments breakdown ---
  const payAgg = new Map<string, any>();
  payments.forEach((p) => {
    const m = p.payment_method || "unknown";
    const cur = payAgg.get(m) || { method: m, count: 0, amount: 0 };
    cur.count += 1;
    cur.amount += Number(p.amount || 0);
    payAgg.set(m, cur);
  });
  const payRows = Array.from(payAgg.values())
    .sort((a, b) => b.amount - a.amount)
    .map((p) => ({
      method: String(p.method).toUpperCase(),
      count: p.count,
      amount: p.amount,
      share: totalCollected > 0 ? p.amount / totalCollected : 0,
    }));
  const wsPay = buildSheet(
    "Payment Methods",
    `${format(range.from, "MMM d, yyyy")} – ${format(range.to, "MMM d, yyyy")}`,
    [
      { header: "Method", key: "method", width: 16 },
      { header: "Count", key: "count", width: 12, type: "int" },
      { header: "Amount Collected", key: "amount", width: 18, type: "currency" },
      { header: "% of Collected", key: "share", width: 14, type: "pct" },
    ],
    payRows,
    { method: "TOTAL", count: payments.length, amount: totalCollected, share: 1 },
  );

  // --- Customers by City (all-time, includes frozen, only shops with ≥1 invoice ever) ---
  const allShopsRes = await supabase.from("shops").select("id, city");
  const allShopsList: any[] = allShopsRes.data || [];
  const invoicedIds = new Set<string>();
  {
    const PAGE = 1000;
    for (let offset = 0; ; offset += PAGE) {
      const { data, error } = await supabase
        .from("invoices")
        .select("shop_id")
        .range(offset, offset + PAGE - 1);
      if (error) throw error;
      if (!data || data.length === 0) break;
      data.forEach((r: any) => r.shop_id && invoicedIds.add(r.shop_id));
      if (data.length < PAGE) break;
    }
  }
  const cityAgg = new Map<string, { city: string; customers: number }>();
  allShopsList.forEach((s) => {
    if (!invoicedIds.has(s.id)) return;
    const city = (s.city && String(s.city).trim()) || "Unknown";
    const cur = cityAgg.get(city) || { city, customers: 0 };
    cur.customers += 1;
    cityAgg.set(city, cur);
  });
  const cityRows = Array.from(cityAgg.values()).sort((a, b) => b.customers - a.customers);
  const totalCityCustomers = cityRows.reduce((s, c) => s + c.customers, 0);
  const wsCities = buildSheet(
    "Customers by City (All-Time)",
    `All shops with at least one invoice — including frozen`,
    [
      { header: "City", key: "city", width: 28 },
      { header: "Customers", key: "customers", width: 14, type: "int" },
    ],
    cityRows,
    { city: "TOTAL", customers: totalCityCustomers },
  );

  // --- Build workbook ---
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, wsSummary, "Summary");
  XLSX.utils.book_append_sheet(wb, wsShops, "Top Shops");
  XLSX.utils.book_append_sheet(wb, wsProducts, "Top Products");
  XLSX.utils.book_append_sheet(wb, wsCat, "By Category");
  XLSX.utils.book_append_sheet(wb, wsSub, "By Sub-Category");
  XLSX.utils.book_append_sheet(wb, wsSubSub, "By Sub-Sub-Cat");
  XLSX.utils.book_append_sheet(wb, wsRegion, "By Region");
  XLSX.utils.book_append_sheet(wb, wsState, "By State");
  XLSX.utils.book_append_sheet(wb, wsCities, "Customers by City");
  XLSX.utils.book_append_sheet(wb, wsDay, "By Day");
  XLSX.utils.book_append_sheet(wb, wsMon, "By Month");
  XLSX.utils.book_append_sheet(wb, wsStaff, "By Staff");
  XLSX.utils.book_append_sheet(wb, wsPay, "Payments");

  const filename = `MR_FOG_Analytics_${format(range.from, "yyyy-MM-dd")}_to_${format(range.to, "yyyy-MM-dd")}.xlsx`;
  XLSX.writeFile(wb, filename);
  return { success: true, filename };
}
