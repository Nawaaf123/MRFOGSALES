import * as XLSX from 'xlsx';
import { supabase } from '@/integrations/supabase/client';

export const exportInvoicesToExcel = async () => {
  try {
    // Fetch all invoices with related data
    const { data: invoices, error: invoicesError } = await supabase
      .from('invoices')
      .select(`
        *,
        shops (
          name,
          owner_name,
          phone,
          email,
          street_address,
          street_address_line_2,
          city,
          state,
          zip_code
        )
      `)
      .order('created_at', { ascending: false });

    if (invoicesError) throw invoicesError;

    // Fetch all profiles for creator names
    const { data: profiles, error: profilesError } = await supabase
      .from('profiles')
      .select('id, full_name');

    if (profilesError) throw profilesError;

    if (!invoices || invoices.length === 0) {
      throw new Error('No invoices found to export');
    }

    // Fetch all invoice items & payments for all invoices.
    // Chunk invoice IDs to avoid "Bad Request" from overly long URLs,
    // and paginate within each chunk to bypass the 1000-row limit.
    const invoiceIds = invoices.map(inv => inv.id);
    const ID_CHUNK = 100;
    const PAGE = 1000;

    const fetchAllByInvoiceIds = async (table: 'invoice_items' | 'payments') => {
      const all: any[] = [];
      for (let i = 0; i < invoiceIds.length; i += ID_CHUNK) {
        const chunk = invoiceIds.slice(i, i + ID_CHUNK);
        for (let offset = 0; ; offset += PAGE) {
          const { data, error } = await supabase
            .from(table)
            .select('*')
            .in('invoice_id', chunk)
            .range(offset, offset + PAGE - 1);
          if (error) throw error;
          if (!data || data.length === 0) break;
          all.push(...data);
          if (data.length < PAGE) break;
        }
      }
      return all;
    };

    const allItems = await fetchAllByInvoiceIds('invoice_items');
    const allPayments = await fetchAllByInvoiceIds('payments');


    // Create Invoice Summary Sheet
    const summaryData = invoices.map(invoice => {
      const payments = allPayments?.filter(p => p.invoice_id === invoice.id) || [];
      const totalPaid = payments.reduce((sum, p) => sum + Number(p.amount), 0);
      const cashPaid = payments
        .filter(p => p.payment_method === 'cash')
        .reduce((sum, p) => sum + Number(p.amount), 0);
      const checkPaid = payments
        .filter(p => p.payment_method === 'check')
        .reduce((sum, p) => sum + Number(p.amount), 0);
      
      const creator = profiles?.find(p => p.id === invoice.created_by);

      return {
        'Invoice Number': invoice.invoice_number,
        'Shop Name': invoice.shops?.name || 'N/A',
        'Street Address': invoice.shops?.street_address || 'N/A',
        'Address Line 2': invoice.shops?.street_address_line_2 || '',
        'City': invoice.shops?.city || 'N/A',
        'State': invoice.shops?.state || 'N/A',
        'Zip Code': invoice.shops?.zip_code || 'N/A',
        'Owner Name': invoice.shops?.owner_name || 'N/A',
        'Phone': invoice.shops?.phone || 'N/A',
        'Email': invoice.shops?.email || 'N/A',
        'Date': new Date(invoice.created_at).toLocaleDateString(),
        'Created By': creator?.full_name || 'Unknown',
        'Total Amount': Number(invoice.total_amount).toFixed(2),
        'Payment Status': invoice.payment_status.toUpperCase(),
        'Total Paid': totalPaid.toFixed(2),
        'Cash Paid': cashPaid.toFixed(2),
        'Check Paid': checkPaid.toFixed(2),
        'Remaining': (Number(invoice.total_amount) - totalPaid).toFixed(2),
        'Notes': invoice.notes || '',
      };
    });

    // Create Invoice Details Sheet (with items)
    const detailsData: any[] = [];
    invoices.forEach(invoice => {
      const items = allItems?.filter(item => item.invoice_id === invoice.id) || [];
      items.forEach(item => {
        detailsData.push({
          'Invoice Number': invoice.invoice_number,
          'Shop Name': invoice.shops?.name || 'N/A',
          'Date': new Date(invoice.created_at).toLocaleDateString(),
          'Product Name': item.product_name,
          'Quantity': item.quantity,
          'Unit Price': Number(item.unit_price).toFixed(2),
          'Subtotal': Number(item.subtotal).toFixed(2),
          'Invoice Total': Number(invoice.total_amount).toFixed(2),
          'Payment Status': invoice.payment_status.toUpperCase(),
        });
      });
    });

    // Create Payments Sheet
    const paymentsData = allPayments?.map(payment => {
      const invoice = invoices.find(inv => inv.id === payment.invoice_id);
      return {
        'Invoice Number': invoice?.invoice_number || 'N/A',
        'Shop Name': invoice?.shops?.name || 'N/A',
        'Payment Date': new Date(payment.payment_date).toLocaleDateString(),
        'Amount': Number(payment.amount).toFixed(2),
        'Payment Method': payment.payment_method.toUpperCase(),
        'Check Number': payment.check_number || 'N/A',
        'Notes': payment.notes || '',
      };
    }) || [];

    // Create Shop Balances Sheet
    const shopBalancesMap: Record<string, { 
      shopName: string; ownerName: string; phone: string;
      streetAddress: string; addressLine2: string; city: string; state: string; zipCode: string;
      totalInvoiced: number; totalPaid: number; cashPaid: number; checkPaid: number;
      invoiceCount: number; unpaidCount: number;
    }> = {};

    invoices.forEach(invoice => {
      const shopId = invoice.shop_id;
      const payments = allPayments?.filter(p => p.invoice_id === invoice.id) || [];
      const totalPaid = payments.reduce((sum, p) => sum + Number(p.amount), 0);
      const cashPaid = payments.filter(p => p.payment_method === 'cash').reduce((sum, p) => sum + Number(p.amount), 0);
      const checkPaid = payments.filter(p => p.payment_method === 'check').reduce((sum, p) => sum + Number(p.amount), 0);

      if (!shopBalancesMap[shopId]) {
        shopBalancesMap[shopId] = {
          shopName: invoice.shops?.name || 'N/A',
          ownerName: invoice.shops?.owner_name || 'N/A',
          phone: invoice.shops?.phone || 'N/A',
          streetAddress: invoice.shops?.street_address || 'N/A',
          addressLine2: invoice.shops?.street_address_line_2 || '',
          city: invoice.shops?.city || 'N/A',
          state: invoice.shops?.state || 'N/A',
          zipCode: invoice.shops?.zip_code || 'N/A',
          totalInvoiced: 0, totalPaid: 0, cashPaid: 0, checkPaid: 0,
          invoiceCount: 0, unpaidCount: 0,
        };
      }
      const shop = shopBalancesMap[shopId];
      shop.totalInvoiced += Number(invoice.total_amount);
      shop.totalPaid += totalPaid;
      shop.cashPaid += cashPaid;
      shop.checkPaid += checkPaid;
      shop.invoiceCount += 1;
      if (invoice.payment_status !== 'paid') shop.unpaidCount += 1;
    });

    const shopBalancesData = Object.values(shopBalancesMap)
      .map(shop => ({
        'Shop Name': shop.shopName,
        'Owner': shop.ownerName,
        'Phone': shop.phone,
        'Street Address': shop.streetAddress,
        'Address Line 2': shop.addressLine2,
        'City': shop.city,
        'State': shop.state,
        'Zip Code': shop.zipCode,
        'Total Invoices': shop.invoiceCount,
        'Unpaid Invoices': shop.unpaidCount,
        'Total Invoiced': shop.totalInvoiced.toFixed(2),
        'Total Paid': shop.totalPaid.toFixed(2),
        'Cash Paid': shop.cashPaid.toFixed(2),
        'Check Paid': shop.checkPaid.toFixed(2),
        'Remaining Balance': (shop.totalInvoiced - shop.totalPaid).toFixed(2),
      }))
      .filter(shop => Number(shop['Remaining Balance']) > 0)
      .sort((a, b) => Number(b['Remaining Balance']) - Number(a['Remaining Balance']));

    // Create workbook and sheets
    const wb = XLSX.utils.book_new();

    if (shopBalancesData.length > 0) {
      const balancesWs = XLSX.utils.json_to_sheet(shopBalancesData);
      XLSX.utils.book_append_sheet(wb, balancesWs, 'Shop Balances');
    }
    
    const summaryWs = XLSX.utils.json_to_sheet(summaryData);
    XLSX.utils.book_append_sheet(wb, summaryWs, 'Invoice Summary');
    
    const detailsWs = XLSX.utils.json_to_sheet(detailsData);
    XLSX.utils.book_append_sheet(wb, detailsWs, 'Invoice Details');
    
    if (paymentsData.length > 0) {
      const paymentsWs = XLSX.utils.json_to_sheet(paymentsData);
      XLSX.utils.book_append_sheet(wb, paymentsWs, 'Payments');
    }

    // Auto-size columns
    const allSheets = [summaryWs, detailsWs];
    if (shopBalancesData.length > 0) allSheets.unshift(wb.Sheets['Shop Balances']);
    allSheets.forEach(ws => {
      const cols: any[] = [];
      const range = XLSX.utils.decode_range(ws['!ref'] || 'A1');
      for (let C = range.s.c; C <= range.e.c; ++C) {
        let maxWidth = 10;
        for (let R = range.s.r; R <= range.e.r; ++R) {
          const cellAddress = XLSX.utils.encode_cell({ r: R, c: C });
          const cell = ws[cellAddress];
          if (cell && cell.v) {
            const cellLength = cell.v.toString().length;
            maxWidth = Math.max(maxWidth, cellLength);
          }
        }
        cols.push({ wch: Math.min(maxWidth + 2, 50) });
      }
      ws['!cols'] = cols;
    });

    // Generate filename with current date
    const today = new Date().toISOString().split('T')[0];
    const filename = `MR_FOG_Invoices_${today}.xlsx`;

    // Write file
    XLSX.writeFile(wb, filename);

    return { success: true, filename };
  } catch (error) {
    console.error('Error exporting invoices:', error);
    throw error;
  }
};
