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
  items?: Array<{
    description: string;
    quantity: number;
    amount: number;
  }>;
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
      
      // Items table
      const vatRate = invoiceData.vatRate || 20;
      const hasItems = invoiceData.items && invoiceData.items.length > 0;
      
      doc.fontSize(14)
        .text('Items', { underline: true })
        .moveDown(0.5);
      
      doc.fontSize(10);
      
      // Table header
      const startY = doc.y;
      const tableTop = startY;
      const col1X = 50;  // Description
      const col2X = 350; // Quantity
      const col3X = 400; // Unit Price
      const col4X = 500; // Total
      const tableWidth = 500;
      
      doc.font('Helvetica-Bold')
        .text('Description', col1X, startY, { width: 280 })
        .text('Qty', col2X, startY, { width: 40, align: 'center' })
        .text('Unit Price', col3X, startY, { width: 80, align: 'right' })
        .text('Total', col4X, startY, { width: 50, align: 'right' })
        .font('Helvetica');
      
      doc.moveDown(0.3);
      const headerBottom = doc.y;
      
      // Separator line after header
      doc.moveTo(col1X, headerBottom)
        .lineTo(col1X + tableWidth, headerBottom)
        .stroke()
        .moveDown(0.3);
      
      let currentY = doc.y;
      let subtotal = 0;
      
      if (hasItems) {
        // Render items from items array
        for (const item of invoiceData.items!) {
          const itemY = currentY;
          const itemDescription = item.description.length > 40 ? 
            item.description.substring(0, 37) + '...' : 
            item.description;
          
          doc.text(itemDescription, col1X, itemY, { width: 280 })
            .text(item.quantity.toString(), col2X, itemY, { width: 40, align: 'center' })
            .text(`£${(item.amount / item.quantity).toFixed(2)}`, col3X, itemY, { width: 80, align: 'right' })
            .text(`£${item.amount.toFixed(2)}`, col4X, itemY, { width: 50, align: 'right' });
          
          subtotal += item.amount;
          currentY = doc.y;
          doc.moveDown(0.3);
        }
      } else {
        // Single item from description
        const itemDescription = invoiceData.description.length > 40 ? 
          invoiceData.description.substring(0, 37) + '...' : 
          invoiceData.description;
        
        doc.text(itemDescription, col1X, currentY, { width: 280 })
          .text('1', col2X, currentY, { width: 40, align: 'center' })
          .text(`£${invoiceData.amount.toFixed(2)}`, col3X, currentY, { width: 80, align: 'right' })
          .text(`£${invoiceData.totalAmount.toFixed(2)}`, col4X, currentY, { width: 50, align: 'right' });
        
        subtotal = invoiceData.totalAmount;
        doc.moveDown(0.3);
      }
      
      // Separator line before totals
      const totalsStartY = doc.y;
      doc.moveTo(col1X, totalsStartY)
        .lineTo(col1X + tableWidth, totalsStartY)
        .stroke()
        .moveDown(0.3);
      
      // Calculate totals (amounts already include VAT)
      const calculatedSubtotal = hasItems ? subtotal : invoiceData.amount;
      const calculatedVAT = hasItems ? 0 : invoiceData.vatAmount; // VAT already included in items
      const calculatedTotal = invoiceData.totalAmount;
      
      // Subtotal
      doc.text('', col1X, doc.y, { width: 280 })
        .text('Subtotal:', col3X, doc.y, { width: 80, align: 'right' })
        .text(`£${calculatedSubtotal.toFixed(2)}`, col4X, doc.y, { width: 50, align: 'right' })
        .moveDown(0.3);
      
      // VAT (only show if not already included in items)
      if (!hasItems && calculatedVAT > 0) {
        doc.text('', col1X, doc.y, { width: 280 })
          .text(`VAT (${vatRate}%):`, col3X, doc.y, { width: 80, align: 'right' })
          .text(`£${calculatedVAT.toFixed(2)}`, col4X, doc.y, { width: 50, align: 'right' })
          .moveDown(0.3);
      }
      
      // Separator line before grand total
      doc.moveTo(col3X, doc.y)
        .lineTo(col1X + tableWidth, doc.y)
        .stroke()
        .moveDown(0.3);
      
      // Bold total
      doc.font('Helvetica-Bold')
        .text('', col1X, doc.y, { width: 280 })
        .text('Total:', col3X, doc.y, { width: 80, align: 'right' })
        .text(`£${calculatedTotal.toFixed(2)}`, col4X, doc.y, { width: 50, align: 'right' })
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
