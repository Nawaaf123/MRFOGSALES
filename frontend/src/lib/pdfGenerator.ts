import { format } from "date-fns";

interface InvoiceItem {
  product_name: string;
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
    head: [["Product", "Quantity", "Unit Price", "Subtotal"]],
    body: invoice.items.map(item => [
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
      cellPadding: 4
    },
    columnStyles: {
      0: { cellWidth: 80 },
      1: { halign: "center", cellWidth: 30 },
      2: { halign: "right", cellWidth: 35 },
      3: { halign: "right", cellWidth: 35 }
    }
  });
  
  yPos = (doc as any).lastAutoTable.finalY + 10;
  
  // Payment Summary Box
  const boxX = pageWidth - 75;
  const boxWidth = 60;
  let boxY = yPos;
  
  const discount = Number(invoice.discount_amount) || 0;
  const subtotal = Number(invoice.total_amount) + discount;
  const boxHeight = discount > 0 ? 43 : 35;
  
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
      columnStyles: {
        0: { cellWidth: 40 },
        1: { halign: "right", cellWidth: 25 },
        2: { halign: "center", cellWidth: 25 },
        3: { halign: "center", cellWidth: 25 },
        4: { cellWidth: 65 }
      }
    });
    
    yPos = (doc as any).lastAutoTable.finalY + 10;
  }
  
  // Notes
  if (invoice.notes) {
    if (yPos > 250) {
      doc.addPage();
      yPos = 20;
    }
    
    doc.setTextColor(...darkColor);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(11);
    doc.text("NOTES:", 15, yPos);
    yPos += 5;
    
    doc.setFont("helvetica", "normal");
    doc.setFontSize(9);
    const splitNotes = doc.splitTextToSize(invoice.notes, pageWidth - 30);
    doc.text(splitNotes, 15, yPos);
    yPos += splitNotes.length * 5;
  }
  
  // Footer
  const footerY = doc.internal.pageSize.height - 20;
  doc.setFontSize(8);
  doc.setTextColor(128, 128, 128);
  doc.text("Thank you for your business!", pageWidth / 2, footerY, { align: "center" });
  
  return doc;
};

export const saveInvoicePDF = async (invoice: InvoiceData, totalPaid: number, remainingAmount: number) => {
  const doc = await generateInvoicePDF(invoice, totalPaid, remainingAmount);
  doc.save(`${invoice.invoice_number}.pdf`);
};
