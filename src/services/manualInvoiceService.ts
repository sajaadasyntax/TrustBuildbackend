import path from 'path';
import fs from 'fs';
import { generateInvoicePDF } from '../../services/pdfService';
import { createServiceEmail, createEmailService } from './emailService';
import { prisma } from '../config/database';

// Generate unique invoice number
export const generateInvoiceNumber = async (): Promise<string> => {
  const prefix = 'MAN';
  const year = new Date().getFullYear();
  const month = String(new Date().getMonth() + 1).padStart(2, '0');
  
  // Get count of manual invoices this month
  const startOfMonth = new Date(year, new Date().getMonth(), 1);
  const endOfMonth = new Date(year, new Date().getMonth() + 1, 0);
  
  const count = await prisma.manualInvoice.count({
    where: {
      createdAt: {
        gte: startOfMonth,
        lte: endOfMonth,
      },
    },
  });

  const sequence = String(count + 1).padStart(4, '0');
  return `${prefix}-${year}${month}-${sequence}`;
};

// Generate and save invoice PDF
export const generateAndSaveInvoicePDF = async (invoiceId: string): Promise<string> => {
  const invoice = await prisma.manualInvoice.findUnique({
    where: { id: invoiceId },
    include: {
      contractor: {
        include: {
          user: {
            select: {
              name: true,
              email: true,
            },
          },
        },
      },
      items: true,
    },
  });

  if (!invoice) {
    throw new Error('Invoice not found');
  }

  // Create invoice data for PDF
  const invoiceData = {
    invoiceNumber: invoice.number,
    recipientName: invoice.contractor.businessName || invoice.contractor.user.name,
    recipientEmail: invoice.contractor.user.email,
    recipientAddress: invoice.contractor.businessAddress || '',
    description: invoice.reason || 'Manual invoice for services',
    amount: invoice.subtotal / 100, // Convert from pence to pounds
    vatAmount: invoice.tax / 100,
    totalAmount: invoice.total / 100,
    issuedAt: invoice.issuedAt || new Date(),
    dueAt: invoice.dueDate || undefined,
    paidAt: invoice.paidAt || undefined,
    paymentType: 'Manual Invoice',
    vatRate: 20,
    items: invoice.items.map(item => ({
      description: item.description,
      quantity: item.quantity,
      amount: item.amount / 100,
    })),
  };

  // Generate PDF
  const pdfBuffer = await generateInvoicePDF(invoiceData);

  // Save PDF to disk
  const invoiceDir = path.join(process.cwd(), 'uploads', 'invoices');
  if (!fs.existsSync(invoiceDir)) {
    fs.mkdirSync(invoiceDir, { recursive: true });
  }

  const pdfPath = path.join(invoiceDir, `${invoice.number}.pdf`);
  fs.writeFileSync(pdfPath, pdfBuffer);

  // Update invoice with PDF path
  await prisma.manualInvoice.update({
    where: { id: invoiceId },
    data: {
      pdfPath,
    },
  });

  return pdfPath;
};

// Send invoice email
export const sendInvoiceEmail = async (invoiceId: string): Promise<void> => {
  const invoice = await prisma.manualInvoice.findUnique({
    where: { id: invoiceId },
    include: {
      contractor: {
        include: {
          user: {
            select: {
              name: true,
              email: true,
            },
          },
        },
      },
      items: true,
    },
  });

  if (!invoice) {
    throw new Error('Invoice not found');
  }

  // Build items table
  const itemsHtml = invoice.items
    .map(
      item => `
      <tr>
        <td style="padding: 8px; border-bottom: 1px solid #ddd;">${item.description}</td>
        <td style="padding: 8px; border-bottom: 1px solid #ddd; text-align: center;">${item.quantity}</td>
        <td style="padding: 8px; border-bottom: 1px solid #ddd; text-align: right;">£${(item.amount / 100).toFixed(2)}</td>
      </tr>
    `
    )
    .join('');

  const emailContent = createServiceEmail({
    to: invoice.contractor.user.email,
    subject: `Invoice ${invoice.number} - TrustBuild`,
    heading: 'New Invoice',
    body: `
      <p>Dear ${invoice.contractor.businessName || invoice.contractor.user.name},</p>
      <p>Please find your invoice details below:</p>
      
      <table style="width: 100%; margin: 20px 0; border-collapse: collapse;">
        <tr style="background: #f8f9fa;">
          <th style="padding: 10px; text-align: left; border-bottom: 2px solid #ddd;">Item</th>
          <th style="padding: 10px; text-align: center; border-bottom: 2px solid #ddd;">Qty</th>
          <th style="padding: 10px; text-align: right; border-bottom: 2px solid #ddd;">Amount</th>
        </tr>
        ${itemsHtml}
        <tr>
          <td colspan="2" style="padding: 8px; text-align: right; font-weight: bold;">Subtotal:</td>
          <td style="padding: 8px; text-align: right;">£${(invoice.subtotal / 100).toFixed(2)}</td>
        </tr>
        <tr>
          <td colspan="2" style="padding: 8px; text-align: right; font-weight: bold;">VAT (20%):</td>
          <td style="padding: 8px; text-align: right;">£${(invoice.tax / 100).toFixed(2)}</td>
        </tr>
        <tr style="background: #f8f9fa;">
          <td colspan="2" style="padding: 12px; text-align: right; font-weight: bold; font-size: 16px;">Total:</td>
          <td style="padding: 12px; text-align: right; font-weight: bold; font-size: 16px;">£${(invoice.total / 100).toFixed(2)}</td>
        </tr>
      </table>

      <p><strong>Invoice Number:</strong> ${invoice.number}</p>
      <p><strong>Issue Date:</strong> ${invoice.issuedAt?.toLocaleDateString() || 'N/A'}</p>
      ${invoice.dueDate ? `<p><strong>Due Date:</strong> ${invoice.dueDate.toLocaleDateString()}</p>` : ''}
      ${invoice.reason ? `<p><strong>Notes:</strong> ${invoice.reason}</p>` : ''}

      <p>The invoice PDF is attached to this email.</p>
      <p>Please make payment by the due date to avoid any service interruption.</p>
    `,
    ctaText: 'View Invoice',
    ctaUrl: `${process.env.FRONTEND_URL}/dashboard/contractor/invoices`,
  });

  // TODO: Attach PDF to email when email service supports attachments
  // For now, PDF is accessible via the platform

  const emailService = createEmailService();
  // Add emailType to options for logging
  (emailContent as any).emailType = 'invoice';
  await emailService.sendMail(emailContent);


};

// Send invoice reminder
export const sendInvoiceReminder = async (invoiceId: string): Promise<void> => {
  const invoice = await prisma.manualInvoice.findUnique({
    where: { id: invoiceId },
    include: {
      contractor: {
        include: {
          user: {
            select: {
              name: true,
              email: true,
            },
          },
        },
      },
    },
  });

  if (!invoice) {
    throw new Error('Invoice not found');
  }

  const emailContent = createServiceEmail({
    to: invoice.contractor.user.email,
    subject: `⏰ Payment Reminder: Invoice ${invoice.number} - TrustBuild`,
    heading: 'Payment Reminder',
    body: `
      <p>Dear ${invoice.contractor.businessName || invoice.contractor.user.name},</p>
      <p>This is a reminder that invoice <strong>${invoice.number}</strong> is ${
        invoice.status === 'OVERDUE' ? 'overdue' : 'due soon'
      }.</p>
      
      <p><strong>Invoice Amount:</strong> £${(invoice.total / 100).toFixed(2)}</p>
      ${invoice.dueDate ? `<p><strong>Due Date:</strong> ${invoice.dueDate.toLocaleDateString()}</p>` : ''}
      
      <p>Please make payment as soon as possible to avoid any service interruption.</p>
    `,
    ctaText: 'View Invoice',
    ctaUrl: `${process.env.FRONTEND_URL}/dashboard/contractor/invoices`,
  });

  const emailService = createEmailService();
  // Add emailType to options for logging
  (emailContent as any).emailType = 'invoice_reminder';
  await emailService.sendMail(emailContent);

  // Update reminder count
  await prisma.manualInvoice.update({
    where: { id: invoiceId },
    data: {
      remindersSent: { increment: 1 },
      lastReminderAt: new Date(),
    },
  });


};

