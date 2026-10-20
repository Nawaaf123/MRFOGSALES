import { format } from "date-fns";

interface InvoiceItem {
  product_name: string;
  product_sku?: string | null;
  quantity: number;
  unit_price: number;
  subtotal: number;
}

interface Payment {
  payment_date: string;
  amount: number;
  payment_method: string;
  check_number?: string;
  notes?: string;
}

interface InvoiceData {
  invoice_number: string;
  created_at: string;
  total_amount: number;
  discount_amount?: number;
  payment_status: string;
  notes?: string;
  shops: {
    name: string;
    owner_name?: string;
    street_address?: string;
    street_address_line_2?: string;
    city?: string;
    state?: string;
    zip_code?: string;
    phone?: string;
    email?: string;
  };
  items: InvoiceItem[];
  payments?: Payment[];
}

export const generateInvoicePDF = async (invoice: InvoiceData, totalPaid: number, remainingAmount: number) => {
  // Dynamic import - only loads when function is called
  const [{ default: jsPDF }, { default: autoTable }] = await Promise.all([
    import("jspdf"),
    import("jspdf-autotable")
  ]);

  const doc = new jsPDF();
  const pageWidth = doc.internal.pageSize.width;
  const pageHeight = doc.internal.pageSize.height;
  // Content stops here so it never runs into the footer.
  const contentBottom = pageHeight - 22;
  const ensureSpace = (y: number, needed: number) => {
    if (y + needed <= contentBottom) return y;
    doc.addPage();
    return 20;
  };
  
  // Neutral Colors
  const primaryColor: [number, number, number] = [51, 51, 51]; // Dark gray
  const darkColor: [number, number, number] = [51, 51, 51];
  
  // Header
  doc.setFillColor(...primaryColor);
  doc.rect(0, 0, pageWidth, 40, "F");
  
  doc.setTextColor(255, 255, 255);
  doc.setFontSize(24);
  doc.setFont("helvetica", "bold");
  doc.text("INVOICE", 15, 25);
  
  // Invoice Number (top right)
  doc.setFontSize(12);
  doc.text(invoice.invoice_number, pageWidth - 15, 20, { align: "right" });
  doc.setFontSize(9);
  doc.text(format(new Date(invoice.created_at), "MMM dd, yyyy"), pageWidth - 15, 27, { align: "right" });
  
  // Reset text color for body
  doc.setTextColor(...darkColor);
  
  let yPos = 55;
  
  // Shop Information
  doc.setFontSize(11);
  doc.setFont("helvetica", "bold");
  doc.text("BILL TO:", 15, yPos);
  
  doc.setFont("helvetica", "normal");
  doc.setFontSize(10);
  yPos += 7;
  doc.text(invoice.shops.name, 15, yPos);
  
  if (invoice.shops.owner_name) {
    yPos += 5;
    doc.text(`Attn: ${invoice.shops.owner_name}`, 15, yPos);
  }
  
  if (invoice.shops.street_address) {
    yPos += 5;
    doc.text(invoice.shops.street_address, 15, yPos);
    if (invoice.shops.street_address_line_2) {
      yPos += 5;
      doc.text(invoice.shops.street_address_line_2, 15, yPos);
    }
  }
  
  if (invoice.shops.city || invoice.shops.state || invoice.shops.zip_code) {
    yPos += 5;
    const cityStateZip = [
      invoice.shops.city,
      invoice.shops.state,
      invoice.shops.zip_code
    ].filter(Boolean).join(", ");
    doc.text(cityStateZip, 15, yPos);
  }
  
  if (invoice.shops.phone) {
    yPos += 5;
    doc.text(`Phone: ${invoice.shops.phone}`, 15, yPos);
  }
  
  if (invoice.shops.email) {
    yPos += 5;
    doc.text(`Email: ${invoice.shops.email}`, 15, yPos);
  }
  
  yPos += 15;
  
  // Invoice Items Table
  doc.setFont("helvetica", "bold");
  doc.setFontSize(11);
  doc.text("INVOICE ITEMS", 15, yPos);
  yPos += 5;
  
  autoTable(doc, {
    startY: yPos,
    head: [["SKU", "Product", "Qty", "Unit Price", "Subtotal"]],
    body: invoice.items.map(item => [
      item.product_sku?.trim() || "-",
      item.product_name,
      item.quantity.toString(),
      `$${Number(item.unit_price).toFixed(2)}`,
      `$${Number(item.subtotal).toFixed(2)}`
    ]),
    theme: "grid",
    headStyles: {
      fillColor: primaryColor,
      textColor: [255, 255, 255],
      fontStyle: "bold",
      fontSize: 10
    },
    styles: {
      fontSize: 9,
      cellPadding: 3
    },
    margin: { bottom: pageHeight - contentBottom },
    columnStyles: {
      0: { cellWidth: 28 },
      1: { cellWidth: "auto" },
      2: { halign: "center", cellWidth: 20 },
      3: { halign: "right", cellWidth: 30 },
      4: { halign: "right", cellWidth: 30 }
    }
  });
  
  yPos = (doc as any).lastAutoTable.finalY + 10;
  
  // Payment Summary Box
  const boxX = pageWidth - 75;
  const boxWidth = 60;
  
  const discount = Number(invoice.discount_amount) || 0;
  const subtotal = Number(invoice.total_amount) + discount;
  const boxHeight = discount > 0 ? 51 : 35;
  yPos = ensureSpace(yPos, boxHeight);
  const boxY = yPos;
  
  doc.setFillColor(245, 245, 245);
  doc.rect(boxX, boxY, boxWidth, boxHeight, "F");
  doc.setDrawColor(...darkColor);
  doc.rect(boxX, boxY, boxWidth, boxHeight, "S");
  
  doc.setFontSize(10);
  doc.setFont("helvetica", "normal");
  
  let lineY = boxY + 8;
  
  // Subtotal (only show if there's a discount)
  if (discount > 0) {
    doc.text("Subtotal:", boxX + 5, lineY);
    doc.setFont("helvetica", "bold");
    doc.text(`$${subtotal.toFixed(2)}`, boxX + boxWidth - 5, lineY, { align: "right" });
    lineY += 8;
    
    // Discount
    doc.setFont("helvetica", "normal");
    doc.setTextColor(34, 197, 94); // green
    doc.text("Discount:", boxX + 5, lineY);
    doc.setFont("helvetica", "bold");
    doc.text(`-$${discount.toFixed(2)}`, boxX + boxWidth - 5, lineY, { align: "right" });
    doc.setTextColor(...darkColor);
    lineY += 8;
  }
  
  // Total Amount
  doc.setFont("helvetica", "normal");
  doc.text("Total Amount:", boxX + 5, lineY);
  doc.setFont("helvetica", "bold");
  doc.text(`$${Number(invoice.total_amount).toFixed(2)}`, boxX + boxWidth - 5, lineY, { align: "right" });
  lineY += 8;
  
  // Total Paid
  doc.setFont("helvetica", "normal");
  doc.setTextColor(34, 197, 94); // green
  doc.text("Total Paid:", boxX + 5, lineY);
  doc.setFont("helvetica", "bold");
  doc.text(`$${totalPaid.toFixed(2)}`, boxX + boxWidth - 5, lineY, { align: "right" });
  lineY += 8;
  
  // Remaining
  doc.setFont("helvetica", "normal");
  doc.setTextColor(249, 115, 22); // orange
  doc.text("Remaining:", boxX + 5, lineY);
  doc.setFont("helvetica", "bold");
  doc.text(`$${remainingAmount.toFixed(2)}`, boxX + boxWidth - 5, lineY, { align: "right" });
  lineY += 8;
  
  // Status
  doc.setFont("helvetica", "normal");
  doc.setTextColor(...darkColor);
  doc.text("Status:", boxX + 5, lineY);
  doc.setFont("helvetica", "bold");
  const statusColor = invoice.payment_status === "paid" 
    ? [34, 197, 94] 
    : invoice.payment_status === "partial" 
    ? [249, 115, 22] 
    : [239, 68, 68];
  doc.setTextColor(...statusColor as [number, number, number]);
  doc.text(invoice.payment_status.toUpperCase(), boxX + boxWidth - 5, lineY, { align: "right" });
  
  yPos = boxY + boxHeight + 10;
  
  // Payment History
  if (invoice.payments && invoice.payments.length > 0) {
    // Heading plus the table header and first row stay together.
    yPos = ensureSpace(yPos, 22);
    doc.setTextColor(...darkColor);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(11);
    doc.text("PAYMENT HISTORY", 15, yPos);
    yPos += 5;
    
    autoTable(doc, {
      startY: yPos,
      head: [["Date", "Amount", "Method", "Check #", "Notes"]],
      body: invoice.payments.map(payment => [
        format(new Date(payment.payment_date), "MMM dd, yyyy h:mm a"),
        `$${Number(payment.amount).toFixed(2)}`,
        payment.payment_method,
        payment.check_number || "-",
        payment.notes || "-"
      ]),
      theme: "grid",
      headStyles: {
        fillColor: primaryColor,
        textColor: [255, 255, 255],
        fontStyle: "bold",
        fontSize: 9
      },
      styles: {
        fontSize: 8,
        cellPadding: 3
      },
      margin: { bottom: pageHeight - contentBottom },
      columnStyles: {
        0: { cellWidth: 40 },
        1: { halign: "right", cellWidth: 25 },
        2: { halign: "center", cellWidth: 25 },
        3: { halign: "center", cellWidth: 25 },
        4: { cellWidth: "auto" }
      }
    });
    
    yPos = (doc as any).lastAutoTable.finalY + 10;
  }
  
  // Notes
  if (invoice.notes) {
    doc.setFont("helvetica", "normal");
    doc.setFontSize(9);
    const splitNotes: string[] = doc.splitTextToSize(invoice.notes, pageWidth - 30);
    yPos = ensureSpace(yPos, 5 + Math.min(splitNotes.length, 6) * 5);
    
    doc.setTextColor(...darkColor);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(11);
    doc.text("NOTES:", 15, yPos);
    yPos += 5;
    
    doc.setFont("helvetica", "normal");
    doc.setFontSize(9);
    for (const line of splitNotes) {
      yPos = ensureSpace(yPos, 5);
      doc.text(line, 15, yPos);
      yPos += 5;
    }
  }
  
  // Footer on every page
  const pageCount = doc.getNumberOfPages();
  for (let page = 1; page <= pageCount; page++) {
    doc.setPage(page);
    const footerY = pageHeight - 12;
    doc.setFont("helvetica", "normal");
    doc.setFontSize(8);
    doc.setTextColor(128, 128, 128);
    doc.text("Thank you for your business!", pageWidth / 2, footerY, { align: "center" });
    if (pageCount > 1) {
      doc.text(`${invoice.invoice_number} - Page ${page} of ${pageCount}`, pageWidth - 15, footerY, { align: "right" });
    }
  }
  
  return doc;
};

export const saveInvoicePDF = async (invoice: InvoiceData, totalPaid: number, remainingAmount: number) => {
  const doc = await generateInvoicePDF(invoice, totalPaid, remainingAmount);
  doc.save(`${invoice.invoice_number}.pdf`);
};
