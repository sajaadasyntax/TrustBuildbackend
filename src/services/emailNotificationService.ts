import { createEmailService, createServiceEmail } from './emailService';
import { generateInvoicePDF } from './pdfService';

// Email notification service for automated emails
export const createEmailNotificationService = () => {
  const emailService = createEmailService();

  // Send welcome email to new contractors
  const sendContractorWelcomeEmail = async (contractorData: {
    name: string;
    email: string;
    businessName?: string;
  }) => {
    try {
      const mailOptions = createServiceEmail({
        to: contractorData.email,
        subject: 'Welcome to TrustBuild - Your Contractor Journey Starts Here!',
        heading: `Welcome to TrustBuild, ${contractorData.name}!`,
        body: `
          <p>Congratulations on joining TrustBuild! We're excited to have you as part of our trusted contractor community.</p>
          
          <h3>What's Next?</h3>
          <ul>
            <li><strong>Complete Your Profile:</strong> Add your business details, services, and portfolio to attract more customers</li>
            <li><strong>Get Approved:</strong> Our team will review your profile and approve it for job applications</li>
            <li><strong>Start Browsing Jobs:</strong> Once approved, you can browse and apply for jobs in your area</li>
            <li><strong>Build Your Reputation:</strong> Complete jobs successfully to build reviews and increase your visibility</li>
          </ul>

          <h3>Your Free Credits</h3>
          <p>As a welcome gift, we've given you <strong>3 free credits</strong> to get started. Use these to access job details and apply for your first jobs!</p>

          <h3>Need Help?</h3>
          <p>If you have any questions or need assistance getting started, don't hesitate to reach out to our support team.</p>
        `,
        ctaText: 'Complete Your Profile',
        ctaUrl: 'https://trustbuild.uk/dashboard/contractor/profile',
        footerText: 'Welcome to the TrustBuild family! We look forward to helping you grow your business.'
      });

      await emailService.sendMail(mailOptions);

      return true;
    } catch (error) {
      console.error(`❌ Failed to send contractor welcome email to ${contractorData.email}:`, error);
      return false;
    }
  };

  // Send welcome email to new customers
  const sendCustomerWelcomeEmail = async (customerData: {
    name: string;
    email: string;
  }) => {
    try {
      const mailOptions = createServiceEmail({
        to: customerData.email,
        subject: 'Welcome to TrustBuild - Find Trusted Contractors for Your Projects!',
        heading: `Welcome to TrustBuild, ${customerData.name}!`,
        body: `
          <p>Welcome to TrustBuild! We're here to help you find the perfect contractor for your project.</p>
          
          <h3>How TrustBuild Works</h3>
          <ul>
            <li><strong>Post Your Job:</strong> Describe your project and get matched with qualified contractors</li>
            <li><strong>Review Proposals:</strong> Compare quotes and contractor profiles to make the best choice</li>
            <li><strong>Work with Confidence:</strong> All contractors are vetted and reviewed by other customers</li>
            <li><strong>Leave Reviews:</strong> Help other customers by sharing your experience</li>
          </ul>

          <h3>Ready to Get Started?</h3>
          <p>Post your first job and connect with trusted contractors in your area. It's free to post jobs and receive quotes!</p>

          <h3>Need Help?</h3>
          <p>Our support team is here to help you every step of the way. Don't hesitate to reach out if you have any questions.</p>
        `,
        ctaText: 'Post Your First Job',
        ctaUrl: 'https://trustbuild.uk/post-job',
        footerText: 'Welcome to TrustBuild! We look forward to helping you complete your projects successfully.'
      });

      await emailService.sendMail(mailOptions);

      return true;
    } catch (error) {
      console.error(`❌ Failed to send customer welcome email to ${customerData.email}:`, error);
      return false;
    }
  };

  // Send subscription invoice email
  const sendSubscriptionInvoiceEmail = async (invoiceData: {
    invoiceNumber: string;
    recipientName: string;
    recipientEmail: string;
    plan: string;
    amount: number;
    vatAmount: number;
    totalAmount: number;
    dueDate: Date;
    paidAt?: Date;
  }) => {
    try {
      const isPaid = !!invoiceData.paidAt;
      const planName = invoiceData.plan === 'MONTHLY' ? 'Monthly' : 
                      invoiceData.plan === 'SIX_MONTHS' ? '6-Month' : 'Yearly';

      const mailOptions = createServiceEmail({
        to: invoiceData.recipientEmail,
        subject: `${isPaid ? 'Subscription Payment Confirmation' : 'Subscription Invoice'} - ${invoiceData.invoiceNumber}`,
        heading: `${isPaid ? 'Payment Confirmed' : 'Subscription Invoice'}`,
        body: `
          <p>${isPaid ? 'Thank you for your subscription payment!' : 'Your subscription invoice is ready.'}</p>
          
          <div style="background-color: #f8f9fa; padding: 20px; border-radius: 8px; margin: 20px 0;">
            <h3>Invoice Details</h3>
            <p><strong>Invoice Number:</strong> ${invoiceData.invoiceNumber}</p>
            <p><strong>Plan:</strong> ${planName} Subscription</p>
            <p><strong>Amount:</strong> £${invoiceData.amount.toFixed(2)}</p>
            <p><strong>VAT (20%):</strong> £${invoiceData.vatAmount.toFixed(2)}</p>
            <p><strong>Total Amount:</strong> £${invoiceData.totalAmount.toFixed(2)}</p>
            <p><strong>${isPaid ? 'Paid On:' : 'Due Date:'}</strong> ${(invoiceData.paidAt || invoiceData.dueDate).toLocaleDateString()}</p>
          </div>

          ${isPaid ? `
            <h3>What's Next?</h3>
            <p>Your subscription is now active! You can:</p>
            <ul>
              <li>Browse and apply for unlimited jobs</li>
              <li>Access premium features and tools</li>
              <li>Build your contractor reputation</li>
            </ul>
          ` : `
            <h3>Payment Required</h3>
            <p>Please complete your payment to activate your subscription and start accessing jobs.</p>
          `}
        `,
        ctaText: isPaid ? 'View Dashboard' : 'Complete Payment',
        ctaUrl: isPaid ? 'https://trustbuild.uk/dashboard/contractor' : 'https://trustbuild.uk/pricing',
        footerText: 'Thank you for choosing TrustBuild for your business needs.'
      });

      await emailService.sendMail(mailOptions);

      return true;
    } catch (error) {
      console.error(`❌ Failed to send subscription invoice email to ${invoiceData.recipientEmail}:`, error);
      return false;
    }
  };

  // Send job access purchase invoice email
  const sendJobAccessInvoiceEmail = async (invoiceData: {
    invoiceNumber: string;
    recipientName: string;
    recipientEmail: string;
    jobTitle: string;
    amount: number;
    vatAmount: number;
    totalAmount: number;
    dueDate: Date;
    paidAt?: Date;
    accessMethod: 'CREDIT' | 'STRIPE';
  }) => {
    try {
      const isPaid = !!invoiceData.paidAt;
      const paymentMethod = invoiceData.accessMethod === 'CREDIT' ? 'Credits' : 'Stripe Payment';

      const mailOptions = createServiceEmail({
        to: invoiceData.recipientEmail,
        subject: `${isPaid ? 'Job Access Confirmation' : 'Job Access Invoice'} - ${invoiceData.invoiceNumber}`,
        heading: `${isPaid ? 'Job Access Confirmed' : 'Job Access Invoice'}`,
        body: `
          <p>${isPaid ? 'You now have access to this job!' : 'Your job access invoice is ready.'}</p>
          
          <div style="background-color: #f8f9fa; padding: 20px; border-radius: 8px; margin: 20px 0;">
            <h3>Job Access Details</h3>
            <p><strong>Invoice Number:</strong> ${invoiceData.invoiceNumber}</p>
            <p><strong>Job Title:</strong> ${invoiceData.jobTitle}</p>
            <p><strong>Payment Method:</strong> ${paymentMethod}</p>
            <p><strong>Amount:</strong> £${invoiceData.amount.toFixed(2)}</p>
            <p><strong>VAT (20%):</strong> £${invoiceData.vatAmount.toFixed(2)}</p>
            <p><strong>Total Amount:</strong> £${invoiceData.totalAmount.toFixed(2)}</p>
            <p><strong>${isPaid ? 'Access Granted On:' : 'Due Date:'}</strong> ${(invoiceData.paidAt || invoiceData.dueDate).toLocaleDateString()}</p>
          </div>

          ${isPaid ? `
            <h3>What's Next?</h3>
            <p>You can now:</p>
            <ul>
              <li>View full job details and customer contact information</li>
              <li>Apply for this job with your proposal</li>
              <li>Contact the customer directly if needed</li>
            </ul>
          ` : `
            <h3>Payment Required</h3>
            <p>Please complete your payment to access the full job details and apply.</p>
          `}
        `,
        ctaText: isPaid ? 'View Job Details' : 'Complete Payment',
        ctaUrl: isPaid ? 'https://trustbuild.uk/dashboard/contractor/jobs' : 'https://trustbuild.uk/pricing',
        footerText: 'Good luck with your job application!'
      });

      await emailService.sendMail(mailOptions);

      return true;
    } catch (error) {
      console.error(`❌ Failed to send job access invoice email to ${invoiceData.recipientEmail}:`, error);
      return false;
    }
  };

  // Send commission invoice email
  const sendCommissionInvoiceEmail = async (invoiceData: {
    invoiceNumber: string;
    contractorName: string;
    contractorEmail: string;
    jobTitle: string;
    finalJobAmount: number;
    commissionAmount: number;
    commissionRate?: number;
    vatAmount: number;
    totalAmount: number;
    dueDate: Date;
    paidAt?: Date;
  }) => {
    try {
      const isPaid = !!invoiceData.paidAt;

      const mailOptions = createServiceEmail({
        to: invoiceData.contractorEmail,
        subject: `${isPaid ? 'Commission Payment Confirmation' : 'Commission Invoice'} - ${invoiceData.invoiceNumber}`,
        heading: `${isPaid ? 'Commission Payment Confirmed' : 'Commission Invoice'}`,
        body: `
          <p>${isPaid ? 'Thank you for your commission payment!' : 'Your commission invoice is ready.'}</p>
          
          <div style="background-color: #f8f9fa; padding: 20px; border-radius: 8px; margin: 20px 0;">
            <h3>Commission Details</h3>
            <p><strong>Invoice Number:</strong> ${invoiceData.invoiceNumber}</p>
            <p><strong>Job Title:</strong> ${invoiceData.jobTitle}</p>
            <p><strong>Final Job Amount:</strong> £${invoiceData.finalJobAmount.toFixed(2)}</p>
            <p><strong>Commission Rate:</strong> ${invoiceData.commissionRate || 5}%</p>
            <p><strong>Commission Amount:</strong> £${invoiceData.commissionAmount.toFixed(2)}</p>
            <p><strong>VAT (20%):</strong> £${invoiceData.vatAmount.toFixed(2)}</p>
            <p><strong>Total Amount:</strong> £${invoiceData.totalAmount.toFixed(2)}</p>
            <p><strong>${isPaid ? 'Paid On:' : 'Due Date:'}</strong> ${(invoiceData.paidAt || invoiceData.dueDate).toLocaleDateString()}</p>
          </div>

          ${isPaid ? `
            <h3>Payment Confirmed</h3>
            <p>Your commission payment has been processed successfully. Thank you for using TrustBuild!</p>
          ` : `
            <h3>Payment Required</h3>
            <p>Please complete your commission payment to maintain your active contractor status.</p>
            <p><strong>Important:</strong> Overdue commission payments may result in account suspension.</p>
          `}
        `,
        ctaText: isPaid ? 'View Dashboard' : 'Pay Commission',
        ctaUrl: isPaid ? 'https://trustbuild.uk/dashboard/contractor' : 'https://trustbuild.uk/dashboard/contractor/commissions',
        footerText: 'Thank you for being a trusted contractor on TrustBuild.'
      });

      await emailService.sendMail(mailOptions);

      return true;
    } catch (error) {
      console.error(`❌ Failed to send commission invoice email to ${invoiceData.contractorEmail}:`, error);
      return false;
    }
  };

  // Send payment confirmation email
  const sendPaymentConfirmationEmail = async (paymentData: {
    recipientName: string;
    recipientEmail: string;
    paymentType: 'SUBSCRIPTION' | 'LEAD_ACCESS' | 'COMMISSION';
    amount: number;
    description: string;
    transactionId?: string;
  }) => {
    try {
      const mailOptions = createServiceEmail({
        to: paymentData.recipientEmail,
        subject: 'Payment Confirmation - TrustBuild',
        heading: 'Payment Confirmed',
        body: `
          <p>Thank you for your payment! Your transaction has been processed successfully.</p>
          
          <div style="background-color: #f8f9fa; padding: 20px; border-radius: 8px; margin: 20px 0;">
            <h3>Payment Details</h3>
            <p><strong>Amount:</strong> £${paymentData.amount.toFixed(2)}</p>
            <p><strong>Type:</strong> ${paymentData.paymentType.replace('_', ' ')}</p>
            <p><strong>Description:</strong> ${paymentData.description}</p>
            ${paymentData.transactionId ? `<p><strong>Transaction ID:</strong> ${paymentData.transactionId}</p>` : ''}
            <p><strong>Date:</strong> ${new Date().toLocaleDateString()}</p>
          </div>

          <h3>What's Next?</h3>
          <p>Your payment has been processed and your account has been updated accordingly.</p>
        `,
        ctaText: 'View Dashboard',
        ctaUrl: 'https://trustbuild.uk/dashboard/contractor',
        footerText: 'Thank you for choosing TrustBuild!'
      });

      await emailService.sendMail(mailOptions);

      return true;
    } catch (error) {
      console.error(`❌ Failed to send payment confirmation email to ${paymentData.recipientEmail}:`, error);
      return false;
    }
  };

  return {
    sendContractorWelcomeEmail,
    sendCustomerWelcomeEmail,
    sendSubscriptionInvoiceEmail,
    sendJobAccessInvoiceEmail,
    sendCommissionInvoiceEmail,
    sendPaymentConfirmationEmail,
  };
};

// Export individual functions for easy importing
export const {
  sendContractorWelcomeEmail,
  sendCustomerWelcomeEmail,
  sendSubscriptionInvoiceEmail,
  sendJobAccessInvoiceEmail,
  sendCommissionInvoiceEmail,
  sendPaymentConfirmationEmail,
} = createEmailNotificationService();
