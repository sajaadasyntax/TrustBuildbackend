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
        subject: 'Welcome to TrustBuild - Registration Received',
        heading: `Welcome to TrustBuild, ${contractorData.name}!`,
        body: `
          <p>Thank you for registering with TrustBuild! We've received your contractor application and our team is currently reviewing it.</p>
          
          <h3>What Happens Next?</h3>
          <ol>
            <li><strong>Profile Review:</strong> Our team will review your registration details (typically within 1-2 business days)</li>
            <li><strong>Approval Notification:</strong> You'll receive an email once your profile is approved</li>
            <li><strong>Identity Verification:</strong> After approval, you'll need to complete KYC verification by uploading:
              <ul>
                <li>Government-issued ID (passport or driver's license)</li>
                <li>Proof of address (utility bill or bank statement)</li>
                <li>Company registration documents (if applicable)</li>
                <li>Insurance certificate (public liability insurance)</li>
              </ul>
            </li>
            <li><strong>Choose Your Plan:</strong> Once verified, you can subscribe to a plan to start accessing jobs</li>
          </ol>

          <h3>Important Information</h3>
          <p><strong>Please note:</strong> You won't be able to access your dashboard or apply for jobs until:</p>
          <ul>
            <li>Your profile is approved by our admin team</li>
            <li>You complete the KYC verification process</li>
            <li>You subscribe to one of our contractor plans</li>
          </ul>

          <h3>Need Help?</h3>
          <p>If you have any questions or need assistance, don't hesitate to reach out to our support team.</p>
        `,
        ctaText: 'Visit TrustBuild',
        ctaUrl: 'https://trustbuild.uk',
        footerText: 'Welcome to TrustBuild! We\'ll notify you as soon as your profile is approved.'
      });

      await emailService.sendMail(mailOptions);

      return true;
    } catch (error) {
      console.error(`❌ Failed to send contractor welcome email to ${contractorData.email}:`, error);
      return false;
    }
  };

  // Send contractor approval email
  const sendContractorApprovalEmail = async (contractorData: {
    name: string;
    email: string;
    businessName?: string;
    kycDeadline: Date;
  }) => {
    try {
      const deadlineDays = Math.ceil((contractorData.kycDeadline.getTime() - Date.now()) / (1000 * 60 * 60 * 24));
      
      const mailOptions = createServiceEmail({
        to: contractorData.email,
        subject: '✅ Your TrustBuild Contractor Profile Has Been Approved!',
        heading: `Congratulations, ${contractorData.name}!`,
        body: `
          <p>Great news! Your contractor profile has been approved by our team. You're one step closer to accessing job opportunities on TrustBuild.</p>
          
          <h3>⚠️ Important: Complete Your KYC Verification</h3>
          <p>Before you can start accessing jobs, you must complete your identity verification within <strong>${deadlineDays} days</strong> (deadline: ${contractorData.kycDeadline.toLocaleDateString()}).</p>
          
          <h3>Required Documents:</h3>
          <ul>
            <li><strong>Government-issued ID:</strong> Valid passport or driver's license</li>
            <li><strong>Proof of Address:</strong> Recent utility bill or bank statement (within last 3 months)</li>
            <li><strong>Company Documents:</strong> Registration certificate or proof of business (if applicable)</li>
            <li><strong>Insurance Certificate:</strong> Valid public liability insurance</li>
          </ul>

          <h3>What Happens After KYC Verification?</h3>
          <ol>
            <li>Our team will review your documents (typically within 24-48 hours)</li>
            <li>Once approved, your account status will be set to ACTIVE</li>
            <li>You can then subscribe to a plan and start accessing job leads</li>
            <li>Upload work photos to showcase your portfolio (up to 20 images)</li>
          </ol>

          <h3>Subscription Plans</h3>
          <p>After KYC verification, you'll need to subscribe to one of our plans to receive weekly job credits:</p>
          <ul>
            <li><strong>Standard Plan:</strong> 3 job leads per week</li>
            <li><strong>Premium Plan:</strong> 6 job leads per week</li>
            <li><strong>Enterprise Plan:</strong> Unlimited job leads</li>
          </ul>

          <p><strong>Note:</strong> Job credits are only allocated through active subscriptions. No free credits are provided automatically.</p>

          <h3>Need Help?</h3>
          <p>If you have any questions about the KYC process or need assistance uploading documents, please contact our support team.</p>
        `,
        ctaText: 'Complete KYC Verification',
        ctaUrl: 'https://trustbuild.uk/dashboard/contractor/kyc',
        footerText: 'Welcome to the TrustBuild contractor community! Complete your verification to get started.'
      });

      await emailService.sendMail(mailOptions);

      return true;
    } catch (error) {
      console.error(`❌ Failed to send contractor approval email to ${contractorData.email}:`, error);
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
    sendContractorApprovalEmail,
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
  sendContractorApprovalEmail,
  sendCustomerWelcomeEmail,
  sendSubscriptionInvoiceEmail,
  sendJobAccessInvoiceEmail,
  sendCommissionInvoiceEmail,
  sendPaymentConfirmationEmail,
} = createEmailNotificationService();
