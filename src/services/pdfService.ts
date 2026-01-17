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
      
      // Company Details (HMRC Compliant Header)
      doc.fontSize(18)
        .font('Helvetica-Bold')
        .text('TRUSTBUILDERS LTD', { align: 'left' })
        .font('Helvetica')
        .fontSize(10)
        .text('124 City Road, London, United Kingdom, EC1V 2NX')
        .text('Company Registration No: 16452861')
        .text('VAT Registration No: 496 3800 58')
        .moveDown(0.5);
      
      // Invoice title
      doc.fontSize(20)
        .font('Helvetica-Bold')
        .text('INVOICE', { align: 'right' })
        .font('Helvetica')
        .moveDown(0.5);
      
      // Invoice information (right aligned)
      const invoiceInfoX = 350;
      doc.fontSize(10)
        .text(`Invoice Number:`, invoiceInfoX, doc.y, { continued: true, width: 100 })
        .font('Helvetica-Bold')
        .text(` ${invoiceData.invoiceNumber}`, { align: 'right' })
        .font('Helvetica')
        .text(`Invoice Date:`, invoiceInfoX, doc.y, { continued: true, width: 100 })
        .text(` ${invoiceData.issuedAt.toLocaleDateString('en-GB')}`, { align: 'right' });
      
      if (invoiceData.dueAt) {
        doc.text(`Due Date:`, invoiceInfoX, doc.y, { continued: true, width: 100 })
          .text(` ${invoiceData.dueAt.toLocaleDateString('en-GB')}`, { align: 'right' });
      }
      
      doc.text(`Status:`, invoiceInfoX, doc.y, { continued: true, width: 100 })
        .font('Helvetica-Bold')
        .text(` ${invoiceData.paidAt ? 'PAID' : 'UNPAID'}`, { align: 'right' })
        .font('Helvetica')
        .moveDown(2);
      
      // Bill To section
      doc.fontSize(11)
        .font('Helvetica-Bold')
        .text('BILL TO:', 50, doc.y)
        .font('Helvetica')
        .fontSize(10)
        .text(invoiceData.recipientName)
        .text(invoiceData.recipientEmail);
      
      if (invoiceData.recipientAddress) {
        doc.text(invoiceData.recipientAddress);
      }
      doc.moveDown(2);
      
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
      
      // Calculate totals - VAT is now added on top of subtotal
      const calculatedSubtotal = invoiceData.amount;
      const calculatedVAT = invoiceData.vatAmount;
      const calculatedTotal = invoiceData.totalAmount;
      
      // Subtotal (before VAT)
      doc.fontSize(10)
        .text('Subtotal (excl. VAT):', col3X - 30, doc.y, { width: 110, align: 'right' })
        .text(`£${calculatedSubtotal.toFixed(2)}`, col4X, doc.y - doc.currentLineHeight(), { width: 50, align: 'right' })
        .moveDown(0.3);
      
      // VAT amount
      doc.text(`VAT @ ${vatRate}%:`, col3X - 30, doc.y, { width: 110, align: 'right' })
        .text(`£${calculatedVAT.toFixed(2)}`, col4X, doc.y - doc.currentLineHeight(), { width: 50, align: 'right' })
        .moveDown(0.3);
      
      // Separator line before grand total
      doc.moveTo(col3X - 30, doc.y)
        .lineTo(col1X + tableWidth, doc.y)
        .stroke()
        .moveDown(0.5);
      
      // Bold total (including VAT)
      doc.font('Helvetica-Bold')
        .fontSize(11)
        .text('TOTAL (incl. VAT):', col3X - 30, doc.y, { width: 110, align: 'right' })
        .text(`£${calculatedTotal.toFixed(2)}`, col4X, doc.y - doc.currentLineHeight(), { width: 50, align: 'right' })
        .font('Helvetica')
        .fontSize(10)
        .moveDown(2);
      
      // Payment information
      if (invoiceData.paidAt) {
        doc.font('Helvetica-Bold')
          .text(`Payment received on ${invoiceData.paidAt.toLocaleDateString('en-GB')}`, { align: 'center' })
          .font('Helvetica');
      } else if (invoiceData.dueAt) {
        doc.text(`Payment due by ${invoiceData.dueAt.toLocaleDateString('en-GB')}`, { align: 'center' });
      }
      
      // Footer with full company details (HMRC compliant)
      doc.fontSize(9)
        .text('', 50, 720)
        .moveTo(50, 710)
        .lineTo(545, 710)
        .stroke()
        .moveDown(0.5)
        .text('Thank you for your business', { align: 'center' })
        .moveDown(0.3)
        .font('Helvetica-Oblique')
        .fontSize(8)
        .text('TRUSTBUILDERS LTD | 124 City Road, London, EC1V 2NX', { align: 'center' })
        .text('Company No: 16452861 | VAT No: 496 3800 58', { align: 'center' })
        .font('Helvetica');
      
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
