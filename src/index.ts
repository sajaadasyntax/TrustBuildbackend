import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import compression from 'compression';
import morgan from 'morgan';
import cookieParser from 'cookie-parser';
import dotenv from 'dotenv';
import rateLimit from 'express-rate-limit';
import path from 'path';
import { rawBodyMiddleware } from './routes/webhooks';

import { errorHandler } from './middleware/errorHandler';
import { notFoundHandler } from './middleware/notFoundHandler';
import { logError } from './services/errorLogService';
import authRoutes from './routes/auth';
import userRoutes from './routes/users';
import contractorRoutes from './routes/contractors';
import customerRoutes from './routes/customers';
import jobRoutes from './routes/jobs';
import reviewRoutes from './routes/reviews';
import serviceRoutes from './routes/services';
import adminRoutes from './routes/admin';
import uploadRoutes from './routes/upload';
import paymentRoutes from './routes/payments';
import invoiceRoutes from './routes/invoices';
import subscriptionRoutes from './routes/subscriptions';
import notificationRoutes from './routes/notifications';
import adminInvoiceRoutes from './routes/admin-invoices';
import adminInvoiceRoutesNew from './routes/admin-invoice-routes';
import adminSubscriptionRoutes from './routes/admin-subscriptions';
import contractorDashboardRoutes from './routes/contractor-dashboard';
import webhookRoutes from './routes/webhooks';
// New admin system routes
import adminAuthRoutes from './routes/admin-auth';
import adminSettingsRoutes from './routes/admin-settings';
import adminActivityRoutes from './routes/admin-activity';
import adminJobsRoutes from './routes/admin-jobs';
import adminKycRoutes from './routes/admin-kyc';
import adminManualInvoicesRoutes from './routes/admin-manual-invoices';
import adminPaymentsRoutes from './routes/admin-payments';
import contentRoutes from './routes/content';
import faqRoutes from './routes/faq';
import disputeRoutes from './routes/disputes';
import adminDisputeRoutes from './routes/admin-disputes';
import adminEmailLogsRoutes from './routes/admin-email-logs';
import adminErrorLogsRoutes from './routes/admin-error-logs';
import adminNotificationRoutes from './routes/admin-notifications';
import adminSupportTicketsRoutes from './routes/admin-support-tickets';
import messageRoutes from './routes/messages';

// Load environment variables
dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;

// Trust proxy for rate limiting behind reverse proxy
app.set('trust proxy', 1);

// Rate limiting
const limiter = rateLimit({
  windowMs: parseInt(process.env.RATE_LIMIT_WINDOW_MS || '900000', 10), // 15 minutes
  max: parseInt(process.env.RATE_LIMIT_MAX_REQUESTS || '100', 10), // limit each IP to 100 requests per windowMs
  message: {
    error: 'Too many requests from this IP, please try again later.',
  },
  standardHeaders: true, // Return rate limit info in the `RateLimit-*` headers
  legacyHeaders: false, // Disable the `X-RateLimit-*` headers
});

// Apply rate limiting to all requests
app.use(limiter);

// Security middleware with CORS-friendly settings
app.use(helmet({
  crossOriginResourcePolicy: { policy: "cross-origin" },
  // Disable contentSecurityPolicy for CORS compatibility
  contentSecurityPolicy: false
}));

// CORS configuration
const corsOptions = {
  origin: (origin: string | undefined, callback: (err: Error | null, allow?: boolean) => void) => {
    // Allow requests with no origin (like mobile apps or curl requests)
    if (!origin) return callback(null, true);
    
    const allowedOrigins = [
      'http://localhost:3000',
      'http://localhost:3001',
      'https://trustbuild.uk',
      'https://www.trustbuild.uk',
      'https://api.trustbuild.uk',
      process.env.FRONTEND_URL,
      process.env.API_URL
    ].filter(Boolean).map(url => {
      // Normalize URLs - remove trailing slashes and ensure consistent format
      return url?.replace(/\/$/, '');
    });
    
    // Normalize the incoming origin (remove trailing slash)
    const normalizedOrigin = origin.replace(/\/$/, '');
    
    // Check if the origin is in our allowed list (case-insensitive for protocol)
    const isAllowed = allowedOrigins.some(allowed => {
      const normalizedAllowed = allowed?.toLowerCase();
      const normalizedOriginLower = normalizedOrigin.toLowerCase();
      return normalizedAllowed === normalizedOriginLower;
    });
    
    if (isAllowed) {
      return callback(null, true);
    }
    
    // Log the blocked origin for debugging
    console.warn(`CORS blocked origin: ${origin} (normalized: ${normalizedOrigin})`);
    console.warn(`Allowed origins: ${allowedOrigins.join(', ')}`);
    
    callback(new Error('Not allowed by CORS'));
  },
  credentials: true,
  optionsSuccessStatus: 200,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'Cookie', 'X-Requested-With', 'Accept'],
  exposedHeaders: ['Content-Length', 'Content-Type', 'Set-Cookie'],
  preflightContinue: false,
  maxAge: 86400, // 24 hours
};

app.use(cors(corsOptions));

// CORS error handler - must be before other error handlers
app.use((err: any, req: express.Request, res: express.Response, next: express.NextFunction) => {
  if (err.message === 'Not allowed by CORS') {
    // Return proper CORS error response
    return res.status(403).json({
      status: 'error',
      message: 'CORS: Origin not allowed',
      origin: req.headers.origin || 'No origin header',
    });
  }
  next(err);
});

// Compression middleware
app.use(compression());

// Raw body middleware for Stripe webhooks
app.use(rawBodyMiddleware);

// Body parsing middleware
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Cookie parser
app.use(cookieParser());

// Logging middleware
if (process.env.NODE_ENV === 'development') {
  app.use(morgan('dev'));
} else {
  app.use(morgan('combined'));
}

// Health check endpoint
app.get('/health', (req, res) => {
  res.status(200).json({
    status: 'OK',
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    environment: process.env.NODE_ENV || 'development',
  });
});

// Handle preflight OPTIONS requests for all routes
app.options('*', cors(corsOptions));

// Add a debug route to test CORS
app.get('/api/cors-test', (req, res) => {
  res.status(200).json({
    message: 'CORS is working correctly',
    origin: req.headers.origin || 'No origin header',
    timestamp: new Date().toISOString()
  });
});

// Serve static files from uploads directory
const uploadsPath = path.join(process.cwd(), 'uploads');


// Serve at both /uploads and /api/uploads for compatibility
app.use('/uploads', express.static(uploadsPath));
app.use('/api/uploads', express.static(uploadsPath));

// API Routes
app.use('/api/auth', authRoutes);
app.use('/api/users', userRoutes);
app.use('/api/contractors', contractorRoutes);
app.use('/api/customers', customerRoutes);
app.use('/api/jobs', jobRoutes);
app.use('/api/reviews', reviewRoutes);
app.use('/api/services', serviceRoutes);
app.use('/api/upload', uploadRoutes);
app.use('/api/payments', paymentRoutes);
app.use('/api/invoices', invoiceRoutes);
app.use('/api/subscriptions', subscriptionRoutes);
app.use('/api/notifications', notificationRoutes);
app.use('/api/contractor', contractorDashboardRoutes);
app.use('/api/webhooks', webhookRoutes);
app.use('/api/content', contentRoutes);
app.use('/api/faq', faqRoutes);
app.use('/api/disputes', disputeRoutes);
app.use('/api/messages', messageRoutes);

// Admin system routes - Register more specific routes BEFORE general admin routes
app.use('/api/admin-auth', adminAuthRoutes);
app.use('/api/admin/settings', adminSettingsRoutes);
app.use('/api/admin/activity', adminActivityRoutes);
app.use('/api/admin/jobs', adminJobsRoutes);
app.use('/api/admin/kyc', adminKycRoutes);
app.use('/api/admin/manual-invoices', adminManualInvoicesRoutes);
app.use('/api/admin/payments', adminPaymentsRoutes);
app.use('/api/admin/invoices', adminInvoiceRoutesNew);
app.use('/api/admin/subscriptions', adminSubscriptionRoutes);
app.use('/api/admin/disputes', adminDisputeRoutes);
app.use('/api/admin/email', adminEmailLogsRoutes);
app.use('/api/admin/errors', adminErrorLogsRoutes);
app.use('/api/admin/notifications', adminNotificationRoutes);
app.use('/api/admin/support-tickets', adminSupportTicketsRoutes);
// General admin routes (catch-all, must be last)
app.use('/api/admin', adminRoutes);

// Basic test routes
app.get('/api/test', (req, res) => {
  res.json({ message: 'API is working', status: 'success' });
});

// 404 handler
app.use(notFoundHandler);

// Global error handler
app.use(errorHandler);

// Validate Stripe configuration
if (!process.env.STRIPE_SECRET_KEY) {
  console.error('❌ FATAL ERROR: STRIPE_SECRET_KEY is not configured!');
  console.error('   Please set STRIPE_SECRET_KEY in your .env file');
  process.exit(1);
}





// Import the new email service
import { sendTestEmail } from './services/emailService';

// Start server
app.listen(PORT, () => {



  
  // Send test email on startup
  sendTestEmail();
});

// Handle unhandled promise rejections
process.on('unhandledRejection', async (err: Error) => {
  console.error('Unhandled Promise Rejection:', err.message);
  // Log to database
  await logError(err, undefined, {
    type: 'unhandledRejection',
    process: 'node',
  });
  process.exit(1);
});

// Handle uncaught exceptions
process.on('uncaughtException', async (err: Error) => {
  console.error('Uncaught Exception:', err.message);
  // Log to database
  await logError(err, undefined, {
    type: 'uncaughtException',
    process: 'node',
  });
  process.exit(1);
});

export default app; 
