import PDFDocument from 'pdfkit';
import { Readable } from 'stream';

/**
 * Generates a PDF invoice
 * 
 * @param invoiceData Invoice data to include in the PDF
 * @returns Buffer containing the generated PDF
 */
export async function generateInvoicePDF(invoiceData: {
  invoiceNumber: string;
  recipientName: string;
  recipientEmail: string;
  recipientAddress?: string;
  description: string;
  amount: number;
  vatAmount: number;
  totalAmount: number;
  issuedAt: Date;
  dueAt?: Date;
  paidAt?: Date;
  paymentType?: string;
  vatRate?: number;
}) {
  return new Promise<Buffer>((resolve, reject) => {
    try {
      // Create a PDF document
      const doc = new PDFDocument({
        size: 'A4',
        margins: {
          top: 50,
          bottom: 50,
          left: 50,
          right: 50
        },
        info: {
          Title: `Invoice ${invoiceData.invoiceNumber}`,
          Author: 'TrustBuild',
          Subject: 'Invoice',
          Keywords: 'invoice, trustbuild',
          CreationDate: new Date(),
        }
      });
      
      // Buffer to store the PDF
      const buffers: Buffer[] = [];
      doc.on('data', (buffer) => buffers.push(buffer));
      doc.on('end', () => resolve(Buffer.concat(buffers)));
      
      // Header - Company logo and title
      doc.fontSize(20)
        .text('TrustBuild', { align: 'center' })
        .fontSize(16)
        .text('INVOICE', { align: 'center' })
        .moveDown();
      
      // Invoice information
      doc.fontSize(12)
        .text(`Invoice Number: ${invoiceData.invoiceNumber}`, { align: 'right' })
        .text(`Date: ${invoiceData.issuedAt.toLocaleDateString()}`, { align: 'right' })
        .text(`Status: ${invoiceData.paidAt ? 'PAID' : 'PENDING'}`, { align: 'right' })
        .moveDown(2);
      
      // Recipient information
      doc.fontSize(12)
        .text('Bill To:', { underline: true })
        .text(invoiceData.recipientName)
        .text(invoiceData.recipientEmail)
        .text(invoiceData.recipientAddress || 'No address provided')
        .moveDown(2);
      
      // Description
      doc.fontSize(14)
        .text('Description', { underline: true })
        .moveDown(0.5)
        .fontSize(12)
        .text(invoiceData.description)
        .moveDown(2);
      
      // Pricing table
      const vatRate = invoiceData.vatRate || 20; // Default to 20% if not specified
      doc.fontSize(12);
      
      // Table header
      doc.text('Item', 50, doc.y, { width: 250, align: 'left' })
        .text('Price', 300, doc.y, { width: 100, align: 'right' })
        .text('VAT', 400, doc.y, { width: 100, align: 'right' })
        .text('Total', 500, doc.y, { width: 100, align: 'right' })
        .moveDown(0.5);
      
      // Separator line
      doc.moveTo(50, doc.y)
        .lineTo(550, doc.y)
        .stroke()
        .moveDown(0.5);
      
      // Item row
      const description = invoiceData.description.length > 30 ? 
        invoiceData.description.substring(0, 27) + '...' : 
        invoiceData.description;
      
      doc.text(description, 50, doc.y, { width: 250, align: 'left' })
        .text(`£${invoiceData.amount.toFixed(2)}`, 300, doc.y, { width: 100, align: 'right' })
        .text(`£${invoiceData.vatAmount.toFixed(2)}`, 400, doc.y, { width: 100, align: 'right' })
        .text(`£${invoiceData.totalAmount.toFixed(2)}`, 500, doc.y, { width: 100, align: 'right' })
        .moveDown();
      
      // Total line
      doc.moveTo(50, doc.y)
        .lineTo(550, doc.y)
        .stroke()
        .moveDown(0.5);
      
      doc.text('', 50, doc.y, { width: 250, align: 'left' })
        .text('Subtotal:', 300, doc.y, { width: 100, align: 'right' })
        .text(`£${invoiceData.amount.toFixed(2)}`, 500, doc.y, { width: 100, align: 'right' })
        .moveDown(0.5);
      
      doc.text('', 50, doc.y, { width: 250, align: 'left' })
        .text(`VAT (${vatRate}%):`, 300, doc.y, { width: 100, align: 'right' })
        .text(`£${invoiceData.vatAmount.toFixed(2)}`, 500, doc.y, { width: 100, align: 'right' })
        .moveDown(0.5);
      
      // Separator line
      doc.moveTo(300, doc.y)
        .lineTo(550, doc.y)
        .stroke()
        .moveDown(0.5);
      
      // Bold total
      doc.font('Helvetica-Bold')
        .text('', 50, doc.y, { width: 250, align: 'left' })
        .text('Total:', 300, doc.y, { width: 100, align: 'right' })
        .text(`£${invoiceData.totalAmount.toFixed(2)}`, 500, doc.y, { width: 100, align: 'right' })
        .font('Helvetica')
        .moveDown(2);
      
      // VAT statement - Important for VAT inclusive pricing
      doc.font('Helvetica-Oblique')
        .fontSize(10)
        .text('All prices include VAT at the current rate.', { align: 'center' })
        .moveDown(0.5);
      
      // Payment information
      if (invoiceData.paidAt) {
        doc.text(`Payment received on ${invoiceData.paidAt.toLocaleDateString()}`, { align: 'center' });
      } else if (invoiceData.dueAt) {
        doc.text(`Payment due by ${invoiceData.dueAt.toLocaleDateString()}`, { align: 'center' });
      }
      
      // Footer
      doc.fontSize(10)
        .text('Thank you for using TrustBuild', 50, 700, { align: 'center' })
        .text('TrustBuild Ltd., London, United Kingdom', { align: 'center' });
      
      // Finalize the PDF
      doc.end();
    } catch (error) {
      reject(error);
    }
  });
}

/**
 * Converts a Buffer to a Readable stream
 * 
 * @param buffer The buffer to convert to a stream
 * @returns A Readable stream from the buffer
 */
export function bufferToStream(buffer: Buffer): Readable {
  const stream = new Readable();
  stream.push(buffer);
  stream.push(null);
  return stream;
}
