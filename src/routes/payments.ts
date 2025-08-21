import { Router, Response, NextFunction } from 'express';
import { prisma } from '../config/database';
import { protect, AuthenticatedRequest } from '../middleware/auth';
import { AppError, catchAsync } from '../middleware/errorHandler';
import Stripe from 'stripe';
import nodemailer from 'nodemailer';

const router = Router();

// Initialize Stripe lazily when needed
let stripe: Stripe | null = null;

function getStripeInstance(): Stripe {
  if (!stripe) {
    const stripeKey = process.env.STRIPE_SECRET_KEY;
    
    if (!stripeKey) {
      throw new Error('STRIPE_SECRET_KEY is not configured');
    }
    
    if (!stripeKey.startsWith('sk_test_') && !stripeKey.startsWith('sk_live_')) {
      throw new Error('Invalid Stripe API key format');
    }
    
    stripe = new Stripe(stripeKey, {
      apiVersion: '2023-10-16',
    });
    
    console.log(`✅ Stripe initialized with ${stripeKey.startsWith('sk_live_') ? 'LIVE' : 'TEST'} key`);
  }
  
  return stripe;
}

// Email transporter configuration
const getEmailTransporter = () => {
  return nodemailer.createTransport({
    host: process.env.SMTP_HOST || 'smtp.mailersend.net',
    port: parseInt(process.env.SMTP_PORT || '587'),
    secure: false,
    auth: {
      user: process.env.SMTP_USER,
      pass: process.env.SMTP_PASS,
    },
  });
};

// Send customer notification when contractor purchases their job
async function sendCustomerNotification(customerEmail: string, notificationData: {
  customerName: string;
  contractorName: string;
  jobTitle: string;
  jobId: string;
  purchaseAmount: number;
  purchaseDate: string;
  totalContractorsWithAccess: number;
  maxContractors: number;
}): Promise<boolean> {
  try {
    const transporter = getEmailTransporter();
    
    const mailOptions = {
      from: process.env.EMAIL_FROM || 'noreply@trustbuild.uk',
      to: customerEmail,
      subject: `New Contractor Interest - ${notificationData.jobTitle}`,
      html: `
        <!DOCTYPE html>
        <html>
        <head>
          <style>
            body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
            .header { background-color: #10b981; color: white; padding: 20px; text-align: center; }
            .content { padding: 20px; }
            .notification-details { background-color: #f0fdf4; padding: 15px; border-radius: 5px; margin: 20px 0; border-left: 4px solid #10b981; }
            .footer { background-color: #f1f5f9; padding: 15px; text-align: center; font-size: 12px; }
            .highlight { font-weight: bold; color: #10b981; }
            .progress-bar { background-color: #e5e7eb; height: 10px; border-radius: 5px; overflow: hidden; margin: 10px 0; }
            .progress-fill { background-color: #10b981; height: 100%; transition: width 0.3s ease; }
          </style>
        </head>
        <body>
          <div class="header">
            <h1>🎉 Great News! New Contractor Interest</h1>
          </div>
          
          <div class="content">
            <p>Dear ${notificationData.customerName},</p>
            
            <p>Exciting news! A contractor has just purchased access to your job listing on TrustBuild.</p>
            
            <div class="notification-details">
              <h3>📋 Job Details</h3>
              <table style="width: 100%; border-collapse: collapse;">
                <tr><td><strong>Job Title:</strong></td><td>${notificationData.jobTitle}</td></tr>
                <tr><td><strong>Job ID:</strong></td><td>${notificationData.jobId}</td></tr>
                <tr><td><strong>Purchase Date:</strong></td><td>${notificationData.purchaseDate}</td></tr>
                <tr><td><strong>Purchase Amount:</strong></td><td>£${notificationData.purchaseAmount.toFixed(2)}</td></tr>
              </table>
            </div>
            
            <div class="notification-details">
              <h3>👷 Contractor Information</h3>
              <p><strong>Contractor Name:</strong> ${notificationData.contractorName}</p>
              <p><em>The contractor now has access to your contact details and may reach out to you soon!</em></p>
            </div>
            
            <div class="notification-details">
              <h3>📊 Interest Progress</h3>
              <p><span class="highlight">${notificationData.totalContractorsWithAccess}</span> out of <span class="highlight">${notificationData.maxContractors}</span> contractors have purchased access to this job.</p>
              
              <div class="progress-bar">
                <div class="progress-fill" style="width: ${(notificationData.totalContractorsWithAccess / notificationData.maxContractors) * 100}%"></div>
              </div>
              
              ${notificationData.totalContractorsWithAccess >= notificationData.maxContractors 
                ? '<p style="color: #dc2626; font-weight: bold;">🔴 Maximum contractors reached! No more contractors can purchase this job.</p>'
                : `<p style="color: #059669;">🟢 ${notificationData.maxContractors - notificationData.totalContractorsWithAccess} more contractor${notificationData.maxContractors - notificationData.totalContractorsWithAccess > 1 ? 's' : ''} can still purchase access.</p>`
              }
            </div>
            
            <div style="background-color: #eff6ff; padding: 15px; border-radius: 5px; margin: 20px 0;">
              <h3>💡 What happens next?</h3>
              <ul>
                <li>The contractor can now see your contact details</li>
                <li>They may contact you directly to discuss your project</li>
                <li>You can review and compare multiple contractors before making a decision</li>
                <li>All communication and hiring happens directly between you and the contractors</li>
              </ul>
            </div>
            
            <p>Thank you for trusting TrustBuild to connect you with quality contractors!</p>
            
            <p>Best regards,<br><strong>The TrustBuild Team</strong></p>
          </div>
          
          <div class="footer">
            <p>TrustBuild - Connecting Contractors with Customers</p>
            <p>Login to your dashboard: <a href="https://trustbuild.uk/dashboard">https://trustbuild.uk/dashboard</a></p>
          </div>
        </body>
        </html>
      `,
    };

    await transporter.sendMail(mailOptions);
    console.log(`✅ Customer notification sent successfully to: ${customerEmail}`);
    return true;
  } catch (error) {
    console.error('❌ Failed to send customer notification:', error);
    return false;
  }
}

// Send invoice email function
async function sendInvoiceNotification(recipientEmail: string, invoiceData: {
  invoiceNumber: string;
  contractorName: string;
  amount: number;
  vatAmount: number;
  totalAmount: number;
  description: string;
  dueDate: string;
  jobTitle: string;
  jobId: string;
  paymentMethod?: string;
}): Promise<boolean> {
  try {
    const transporter = getEmailTransporter();
    
    const mailOptions = {
      from: process.env.EMAIL_FROM || 'noreply@trustbuild.uk',
      to: recipientEmail,
      subject: `TrustBuild Invoice ${invoiceData.invoiceNumber}`,
      html: `
        <!DOCTYPE html>
        <html>
        <head>
          <style>
            body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
            .header { background-color: #2563eb; color: white; padding: 20px; text-align: center; }
            .content { padding: 20px; }
            .invoice-details { background-color: #f8f9fa; padding: 15px; border-radius: 5px; margin: 20px 0; }
            .footer { background-color: #f1f5f9; padding: 15px; text-align: center; font-size: 12px; }
            .total { font-weight: bold; font-size: 1.1em; color: #2563eb; }
          </style>
        </head>
        <body>
          <div class="header">
            <h1>TrustBuild Invoice</h1>
          </div>
          
          <div class="content">
            <p>Dear ${invoiceData.contractorName},</p>
            
            <p>Thank you for purchasing job lead access through TrustBuild. Please find your invoice details below:</p>
            
            <div class="invoice-details">
              <h3>Invoice Details</h3>
              <table style="width: 100%; border-collapse: collapse;">
                <tr><td><strong>Invoice Number:</strong></td><td>${invoiceData.invoiceNumber}</td></tr>
                <tr><td><strong>Issue Date:</strong></td><td>${new Date().toLocaleDateString('en-GB')}</td></tr>
                <tr><td><strong>Due Date:</strong></td><td>${invoiceData.dueDate}</td></tr>
                <tr><td><strong>Description:</strong></td><td>${invoiceData.description}</td></tr>
              </table>
            </div>
            
            <div class="invoice-details">
              <h3>Job Details</h3>
              <table style="width: 100%; border-collapse: collapse;">
                <tr><td><strong>Job Title:</strong></td><td>${invoiceData.jobTitle}</td></tr>
                <tr><td><strong>Job ID:</strong></td><td>${invoiceData.jobId}</td></tr>
              </table>
            </div>
            
            <div class="invoice-details">
              <h3>Payment Summary</h3>
              <table style="width: 100%; border-collapse: collapse;">
                ${invoiceData.paymentMethod === 'CREDIT' 
                  ? '<tr><td>Payment Method:</td><td><strong>TrustBuild Credit</strong> 🎉</td></tr><tr><td>Credits Used:</td><td>1 Credit</td></tr><tr class="total"><td><strong>Total Paid:</strong></td><td><strong>£0.00 (Credit)</strong></td></tr>'
                  : `<tr><td>Subtotal:</td><td>£${invoiceData.amount.toFixed(2)}</td></tr><tr><td>VAT (20%):</td><td>£${invoiceData.vatAmount.toFixed(2)}</td></tr><tr><td>Payment Method:</td><td>Card Payment 💳</td></tr><tr class="total"><td><strong>Total Amount:</strong></td><td><strong>£${invoiceData.totalAmount.toFixed(2)}</strong></td></tr>`
                }
              </table>
            </div>
            
            <p>You now have access to the customer contact details for this job. Please log into your TrustBuild dashboard to view them.</p>
            
            <p>If you have any questions about this invoice, please contact our support team.</p>
            
            <p>Best regards,<br><strong>The TrustBuild Team</strong></p>
          </div>
          
          <div class="footer">
            <p>TrustBuild - Connecting Contractors with Customers</p>
            <p>This is an automated email. Please do not reply directly to this message.</p>
          </div>
        </body>
        </html>
      `,
    };

    await transporter.sendMail(mailOptions);
    console.log(`✅ Invoice email sent successfully to: ${recipientEmail}`);
    return true;
  } catch (error) {
    console.error('❌ Failed to send invoice email:', error);
    return false;
  }
}

// @desc    Check if contractor has access to a job
// @route   GET /api/payments/job-access/:jobId
// @access  Private (Contractor only)
export const checkJobAccess = catchAsync(async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
  const { jobId } = req.params;
  const userId = req.user!.id;

  // Get contractor profile
  const contractor = await prisma.contractor.findUnique({
    where: { userId },
    select: { id: true, creditsBalance: true },
  });

  if (!contractor) {
    return next(new AppError('Contractor profile not found', 404));
  }

  // Check if contractor already has access to this job
  const existingAccess = await prisma.jobAccess.findUnique({
    where: {
      jobId_contractorId: {
        jobId,
        contractorId: contractor.id,
      },
    },
  });

  res.status(200).json({
    status: 'success',
    data: {
      hasAccess: !!existingAccess,
      creditsBalance: contractor.creditsBalance,
    },
  });
});

// @desc    Purchase job access using credits or Stripe payment
// @route   POST /api/payments/purchase-job-access
// @access  Private (Contractor only)
export const purchaseJobAccess = catchAsync(async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
  const { jobId, paymentMethod, stripePaymentIntentId } = req.body;
  const userId = req.user!.id;

  // Get contractor profile
  const contractor = await prisma.contractor.findUnique({
    where: { userId },
  });

  if (!contractor) {
    return next(new AppError('Contractor profile not found', 404));
  }

  // Get job details with lead price and current access count
  const job = await prisma.job.findUnique({
    where: { id: jobId },
    include: {
      service: {
        select: {
          smallJobPrice: true,
          mediumJobPrice: true,
          largeJobPrice: true,
        },
      },
      customer: {
        include: {
          user: {
            select: {
              name: true,
              email: true,
            },
          },
        },
      },
      jobAccess: {
        select: {
          id: true,
          contractorId: true,
        },
      },
    },
  });

  if (!job) {
    return next(new AppError('Job not found', 404));
  }

  // Check if contractor already has access
  const existingAccess = job.jobAccess.find(access => access.contractorId === contractor.id);
  
  if (existingAccess) {
    return next(new AppError('You already have access to this job', 400));
  }

  // Check if the maximum number of contractors has been reached
  if (job.jobAccess.length >= job.maxContractorsPerJob) {
    return next(new AppError(`Maximum number of contractors (${job.maxContractorsPerJob}) has already purchased this job`, 400));
  }

  // Calculate lead price based on job size
  let leadPrice = 0;
  if (job.service) {
    switch (job.jobSize) {
      case 'SMALL':
        leadPrice = job.service.smallJobPrice ? job.service.smallJobPrice.toNumber() : 0;
        break;
      case 'MEDIUM':
        leadPrice = job.service.mediumJobPrice ? job.service.mediumJobPrice.toNumber() : 0;
        break;
      case 'LARGE':
        leadPrice = job.service.largeJobPrice ? job.service.largeJobPrice.toNumber() : 0;
        break;
    }
  }

  // Use override price if set
  if (job.leadPrice && typeof job.leadPrice.toNumber === 'function' && job.leadPrice.toNumber() > 0) {
    leadPrice = job.leadPrice.toNumber();
  }

  const transactionResult = await prisma.$transaction(async (tx) => {
    let payment;
    let invoice;

    if (paymentMethod === 'CREDIT') {
      // Check if contractor has enough credits
      if (contractor.creditsBalance < 1) {
        throw new AppError('Insufficient credits. Please top up or pay directly.', 400);
      }

      // Deduct credit
      await tx.contractor.update({
        where: { id: contractor.id },
        data: { creditsBalance: { decrement: 1 } },
      });

      // Create credit transaction
      await tx.creditTransaction.create({
        data: {
          contractorId: contractor.id,
          type: 'DEDUCTION',
          amount: 1,
          description: `Job access purchased for: ${job.title}`,
          jobId,
        },
      });

      // Create payment record
      payment = await tx.payment.create({
        data: {
          contractorId: contractor.id,
          amount: 0,
          type: 'LEAD_ACCESS',
          status: 'COMPLETED',
          description: `Job access purchased with credit for: ${job.title}`,
        },
      });

      // Create invoice
      invoice = await tx.invoice.create({
        data: {
          amount: 0,
          vatAmount: 0,
          totalAmount: 0,
          description: `Job Lead Access - ${job.title}`,
          invoiceNumber: `INV-${Date.now()}-${contractor.id.slice(-6)}`,
          recipientName: job.customer?.user?.name || 'Unknown',
          recipientEmail: job.customer?.user?.email || 'unknown@trustbuild.uk',
        },
      });
    } else if (paymentMethod === 'STRIPE') {
      if (!stripePaymentIntentId) {
        throw new AppError('Stripe payment intent ID is required', 400);
      }

      // Verify payment with Stripe
      const stripe = getStripeInstance();
      const paymentIntent = await stripe.paymentIntents.retrieve(stripePaymentIntentId);
      
      if (paymentIntent.status !== 'succeeded') {
        throw new AppError('Payment not completed', 400);
      }

      if (paymentIntent.amount !== leadPrice * 100) { // Stripe uses cents
        throw new AppError('Payment amount mismatch', 400);
      }

      const vatAmount = leadPrice * 0.2; // 20% VAT
      const totalAmount = leadPrice + vatAmount;

      // Create payment record
      payment = await tx.payment.create({
        data: {
          contractorId: contractor.id,
          amount: leadPrice,
          type: 'LEAD_ACCESS',
          status: 'COMPLETED',
          stripePaymentId: stripePaymentIntentId,
          description: `Job access purchased for: ${job.title}`,
        },
      });

      // Create invoice
      invoice = await tx.invoice.create({
        data: {
          amount: leadPrice,
          vatAmount,
          totalAmount,
          description: `Job Lead Access - ${job.title}`,
          invoiceNumber: `INV-${Date.now()}-${contractor.id.slice(-6)}`,
          recipientName: job.customer?.user?.name || 'Unknown',
          recipientEmail: job.customer?.user?.email || 'unknown@trustbuild.uk',
        },
      });
    } else {
      throw new AppError('Invalid payment method', 400);
    }

    // Grant job access - this will instantly give access to customer contact details
    await tx.jobAccess.create({
      data: {
        contractorId: contractor.id,
        jobId,
        accessMethod: paymentMethod === 'CREDIT' ? 'CREDIT' : 'PAYMENT',
        paidAmount: paymentMethod === 'STRIPE' ? leadPrice : 0,
        creditUsed: paymentMethod === 'CREDIT',
      },
    });

    return { payment, invoice };
  });

  // Send invoice email to contractor and notification to customer
  try {
    const contractorUser = await prisma.user.findUnique({
      where: { id: userId },
      select: { name: true, email: true }
    });

    // 1. Send invoice email to contractor (ALWAYS for all payment types)
    if (contractorUser && contractorUser.email) {
      const emailSent = await sendInvoiceNotification(contractorUser.email, {
        invoiceNumber: transactionResult.invoice.invoiceNumber,
        contractorName: contractorUser.name || 'Contractor',
        amount: transactionResult.invoice.amount?.toNumber() || 0,
        vatAmount: transactionResult.invoice.vatAmount?.toNumber() || 0,
        totalAmount: transactionResult.invoice.totalAmount?.toNumber() || 0,
        description: transactionResult.invoice.description,
        dueDate: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toLocaleDateString('en-GB'),
        jobTitle: job.title,
        jobId: job.id,
        paymentMethod: paymentMethod,
      });

      if (emailSent) {
        console.log(`✅ Invoice email sent to contractor: ${contractorUser.email}`);
      } else {
        console.log(`⚠️ Failed to send invoice email to contractor: ${contractorUser.email}`);
      }
    }

    // 2. Send notification email to customer (ALWAYS for all payment types)
    if (job.customer?.user?.email) {
      const customerNotificationSent = await sendCustomerNotification(job.customer.user.email, {
        customerName: job.customer.user.name || 'Customer',
        contractorName: contractorUser?.name || 'Contractor',
        jobTitle: job.title,
        jobId: job.id,
        purchaseAmount: paymentMethod === 'CREDIT' ? 0 : leadPrice, // Credits show as £0
        purchaseDate: new Date().toLocaleDateString('en-GB'),
        totalContractorsWithAccess: job.jobAccess.length + 1, // Include the new purchase
        maxContractors: job.maxContractorsPerJob,
      });

      if (customerNotificationSent) {
        console.log(`✅ Customer notification sent to: ${job.customer.user.email}`);
      } else {
        console.log(`⚠️ Failed to send customer notification to: ${job.customer.user.email}`);
      }
    }
  } catch (emailError) {
    console.error('❌ Error sending emails:', emailError);
    // Don't fail the payment if email fails
  }

  // Return response with customer contact details since access was granted
  res.status(200).json({
    status: 'success',
    message: 'Job access purchased successfully',
    data: {
      payment: transactionResult.payment,
      invoice: transactionResult.invoice,
      jobAccess: {
        jobId,
        contractorId: contractor.id,
        accessMethod: paymentMethod === 'CREDIT' ? 'CREDIT' : 'PAYMENT'
      },
      // Instantly provide customer contact details
      customerContact: {
        name: job.customer?.user?.name,
        email: job.customer?.user?.email,
        phone: job.customer?.phone,
      },
      contractorsWithAccess: job.jobAccess.length + 1, // Include the new purchase
      maxContractors: job.maxContractorsPerJob,
    }
  });
});

// @desc    Create Stripe payment intent for job access
// @route   POST /api/payments/create-payment-intent
// @access  Private (Contractor only)
export const createPaymentIntent = catchAsync(async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
  const { jobId } = req.body;
  const userId = req.user!.id;

  // Get contractor profile
  const contractor = await prisma.contractor.findUnique({
    where: { userId },
  });

  if (!contractor) {
    return next(new AppError('Contractor profile not found', 404));
  }

  // Get job details with lead price
  const job = await prisma.job.findUnique({
    where: { id: jobId },
    include: {
      service: {
        select: {
          smallJobPrice: true,
          mediumJobPrice: true,
          largeJobPrice: true,
        },
      },
    },
  });

  if (!job) {
    return next(new AppError('Job not found', 404));
  }

  // Calculate lead price
  let leadPrice = 0;
  if (job.service) {
    switch (job.jobSize) {
      case 'SMALL':
        leadPrice = job.service.smallJobPrice ? job.service.smallJobPrice.toNumber() : 0;
        break;
      case 'MEDIUM':
        leadPrice = job.service.mediumJobPrice ? job.service.mediumJobPrice.toNumber() : 0;
        break;
      case 'LARGE':
        leadPrice = job.service.largeJobPrice ? job.service.largeJobPrice.toNumber() : 0;
        break;
    }
  }

  // Use override price if set
  if (job.leadPrice && typeof job.leadPrice.toNumber === 'function' && job.leadPrice.toNumber() > 0) {
    leadPrice = job.leadPrice.toNumber();
  }

  if (leadPrice <= 0) {
    return next(new AppError('Invalid lead price', 400));
  }

  // Create payment intent
  try {
    console.log('🔄 Creating Stripe payment intent for amount:', leadPrice * 100, 'pence');
    
    const stripe = getStripeInstance();
    const paymentIntent = await stripe.paymentIntents.create({
      amount: leadPrice * 100, // Convert to cents
      currency: 'gbp',
      payment_method_types: ['card'], // Required for Apple Pay/Google Pay
      automatic_payment_methods: {
        enabled: true,
        allow_redirects: 'never' // Prevent redirect payment methods for better UX
      },
      metadata: {
        jobId,
        contractorId: contractor.id,
        leadPrice: leadPrice.toString(),
        type: 'job_access_purchase'
      },
    });

    console.log('✅ Payment intent created successfully:', paymentIntent.id);

  res.status(200).json({
    status: 'success',
    data: {
      clientSecret: paymentIntent.client_secret,
      amount: leadPrice,
    },
  });
  } catch (stripeError: any) {
    console.error('❌ Stripe API Error:', stripeError.message);
    console.error('Stripe Error Type:', stripeError.type);
    console.error('Full Stripe Error:', stripeError);
         return next(new AppError(`Stripe payment error: ${stripeError.message}`, 400));
   }
});

// @desc    Get contractor's payment history
// @route   GET /api/payments/history
// @access  Private (Contractor only)
export const getPaymentHistory = catchAsync(async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
  const userId = req.user!.id;
  const page = parseInt(req.query.page as string) || 1;
  const limit = parseInt(req.query.limit as string) || 10;
  const skip = (page - 1) * limit;

  // Get contractor profile
  const contractor = await prisma.contractor.findUnique({
    where: { userId },
    select: { id: true },
  });

  if (!contractor) {
    return next(new AppError('Contractor profile not found', 404));
  }

  // Get payment history
  const payments = await prisma.payment.findMany({
    where: { contractorId: contractor.id },
    include: {
      job: {
        select: {
          id: true,
          title: true,
          location: true,
        },
      },
    },
    orderBy: { createdAt: 'desc' },
    skip,
    take: limit,
  });

  const total = await prisma.payment.count({
    where: { contractorId: contractor.id },
  });

  res.status(200).json({
    status: 'success',
    data: {
      payments,
      pagination: {
        page,
        limit,
        total,
        pages: Math.ceil(total / limit),
      },
    },
  });
});

// @desc    Get contractor's credit transactions
// @route   GET /api/payments/credit-history
// @access  Private (Contractor only)
export const getCreditHistory = catchAsync(async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
  const userId = req.user!.id;
  const page = parseInt(req.query.page as string) || 1;
  const limit = parseInt(req.query.limit as string) || 10;
  const skip = (page - 1) * limit;

  // Get contractor profile
  const contractor = await prisma.contractor.findUnique({
    where: { userId },
    select: { id: true, creditsBalance: true },
  });

  if (!contractor) {
    return next(new AppError('Contractor profile not found', 404));
  }

  // Get credit transactions
  const transactions = await prisma.creditTransaction.findMany({
    where: { contractorId: contractor.id },
    orderBy: { createdAt: 'desc' },
    skip,
    take: limit,
  });

  const total = await prisma.creditTransaction.count({
    where: { contractorId: contractor.id },
  });

  res.status(200).json({
    status: 'success',
    data: {
      transactions,
      currentBalance: contractor.creditsBalance,
      pagination: {
        page,
        limit,
        total,
        pages: Math.ceil(total / limit),
      },
    },
  });
});

// Routes
router.use(protect); // All routes require authentication

router.get('/job-access/:jobId', checkJobAccess);
router.post('/purchase-job-access', purchaseJobAccess);
router.post('/create-payment-intent', createPaymentIntent);
router.get('/history', getPaymentHistory);
router.get('/credit-history', getCreditHistory);

// Test email endpoints (for development/testing)
router.post('/test-invoice-email', catchAsync(async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
  const { email, paymentMethod = 'STRIPE' } = req.body;
  
  if (!email) {
    return next(new AppError('Email address is required', 400));
  }
  
  try {
    const testData = {
      invoiceNumber: 'TEST-INV-001',
      contractorName: 'Test Contractor',
      amount: 10.00,
      vatAmount: 2.00,
      totalAmount: 12.00,
      description: 'Test Invoice - Email System Check',
      dueDate: new Date().toLocaleDateString('en-GB'),
      jobTitle: 'Test Job - Email System Verification',
      jobId: 'test-job-id',
      paymentMethod: paymentMethod,
    };
    
    const emailSent = await sendInvoiceNotification(email, testData);
    
    res.status(200).json({
      status: 'success',
      message: emailSent ? 'Test invoice email sent successfully' : 'Failed to send test invoice email',
      emailSent,
    });
  } catch (error: any) {
    console.error('Test invoice email error:', error);
    return next(new AppError(`Test invoice email failed: ${error.message}`, 500));
  }
}));

router.post('/test-customer-notification', catchAsync(async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
  const { email } = req.body;
  
  if (!email) {
    return next(new AppError('Email address is required', 400));
  }
  
  try {
    const testData = {
      customerName: 'Test Customer',
      contractorName: 'Test Contractor',
      jobTitle: 'Test Job - Kitchen Renovation',
      jobId: 'test-job-123',
      purchaseAmount: 12.00,
      purchaseDate: new Date().toLocaleDateString('en-GB'),
      totalContractorsWithAccess: 2,
      maxContractors: 5,
    };
    
    const emailSent = await sendCustomerNotification(email, testData);
    
    res.status(200).json({
      status: 'success',
      message: emailSent ? 'Test customer notification sent successfully' : 'Failed to send test customer notification',
      emailSent,
    });
  } catch (error: any) {
    console.error('Test customer notification error:', error);
    return next(new AppError(`Test customer notification failed: ${error.message}`, 500));
  }
}));

export default router; 