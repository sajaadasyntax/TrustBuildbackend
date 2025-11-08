import nodemailer from 'nodemailer';
import { MailerSend, EmailParams, Sender, Recipient } from 'mailersend';
import sgMail from '@sendgrid/mail';
import { prisma } from '../config/database';

// Email service with API-based sending
export const createEmailService = () => {
  // Initialize email configuration
  const defaultFromEmail = process.env.EMAIL_FROM || 'noreply@trustbuild.uk';
  const defaultFromName = process.env.EMAIL_FROM_NAME || 'TrustBuild';
  
  // Initialize SendGrid
  const sendGridApiKey = process.env.SENDGRID_API_KEY;
  if (sendGridApiKey) {
    sgMail.setApiKey(sendGridApiKey);

  } else {

  }
  
  // Helper function to log email to database
  const logEmail = async (
    recipient: string,
    subject: string,
    type: string,
    status: 'PENDING' | 'SENT' | 'FAILED',
    error?: string,
    metadata?: any,
    logId?: string,
    emailContent?: string
  ) => {
    try {
      // Prepare metadata with email content
      const logMetadata = {
        ...metadata,
        ...(emailContent && { emailContent: emailContent.substring(0, 50000) }), // Limit content length
      };

      if (logId) {
        // Update existing log
        await prisma.emailLog.update({
          where: { id: logId },
          data: {
            status,
            error: error ? error.substring(0, 5000) : undefined,
            metadata: Object.keys(logMetadata).length > 0 ? logMetadata : undefined,
          },
        });
      } else {
        // Create new log
        const log = await prisma.emailLog.create({
          data: {
            recipient,
            subject,
            type,
            status,
            error: error ? error.substring(0, 5000) : undefined,
            metadata: Object.keys(logMetadata).length > 0 ? logMetadata : undefined,
          },
        });
        return log.id;
      }
    } catch (logError) {
      // Don't throw - email logging failures shouldn't break email sending
      console.error('Failed to log email to database:', logError);
    }
    return undefined;
  };

  // Send email with retry logic and fallbacks
  const sendMail = async (options: nodemailer.SendMailOptions, retries = 2) => {
    // Extract email details for logging
    let recipient: string = 'unknown';
    if (typeof options.to === 'string') {
      recipient = options.to;
    } else if (Array.isArray(options.to) && options.to.length > 0) {
      recipient = typeof options.to[0] === 'string' ? options.to[0] : (options.to[0] as any).address || 'unknown';
    } else if (options.to && typeof options.to === 'object' && 'address' in options.to) {
      recipient = (options.to as any).address;
    }
    
    const subject = options.subject || 'No subject';
    const emailType = (options as any).emailType || 'general'; // Allow emailType to be passed in options
    
    // Extract email content (HTML or text)
    const emailContent = options.html || options.text || '';
    
    // Log email as PENDING and get log ID
    const logId = await logEmail(recipient, subject, emailType, 'PENDING', undefined, {
      from: typeof options.from === 'string' ? options.from : (options.from as any)?.address,
    }, undefined, emailContent);

    try {
      let result;
      // Try SendGrid first if API key is available
      if (sendGridApiKey) {
        result = await sendWithSendGrid(options, retries);
      } else {
        // Fallback to nodemailer with Gmail configuration
        result = await sendWithNodemailer(options, retries);
      }
      
      // Update log to SENT (preserve email content)
      if (logId) {
        await logEmail(recipient, subject, emailType, 'SENT', undefined, {
          messageId: result?.messageId,
          from: typeof options.from === 'string' ? options.from : (options.from as any)?.address,
        }, logId, emailContent);
      }
      
      return result;
    } catch (error: any) {
      // Update log to FAILED (preserve email content)
      if (logId) {
        await logEmail(recipient, subject, emailType, 'FAILED', error.message || String(error), {
          from: typeof options.from === 'string' ? options.from : (options.from as any)?.address,
          errorCode: error.code,
          errorStatus: error.status,
        }, logId, emailContent);
      }
      
      // If we get here, all email sending attempts have failed
      console.error(`
      ❌ ALL EMAIL SENDING ATTEMPTS FAILED ❌
      For production environments, consider implementing one of these more reliable email services:
      - SendGrid: https://www.npmjs.com/package/@sendgrid/mail
      - Mailgun: https://www.npmjs.com/package/mailgun-js
      - AWS SES: https://www.npmjs.com/package/@aws-sdk/client-ses
      
      These services use HTTP APIs instead of SMTP and are more reliable in hosted environments.
      `);
      throw error;
    }
  };
  
  // Send using MailerSend API (deprecated but kept for reference)
  const sendWithMailerSendAPI = async (options: nodemailer.SendMailOptions, retries = 2) => {
    const apiToken = process.env.MAILERSEND_API_TOKEN;
    const mailerSend = new MailerSend({
      apiKey: apiToken || ''  // Note: using apiKey (camelCase), not api_key
    });

    // Parse recipients - handle both string and array formats
    const recipientObjects: Recipient[] = [];
    if (typeof options.to === 'string') {
      recipientObjects.push(new Recipient(options.to));
    } else if (Array.isArray(options.to)) {
      options.to.forEach(recipient => {
        if (typeof recipient === 'string') {
          recipientObjects.push(new Recipient(recipient));
        }
      });
    }
    
    // Extract from email and name
    let fromEmail = defaultFromEmail;
    let fromName = defaultFromName;
    
    if (options.from) {
      if (typeof options.from === 'string') {
        fromEmail = options.from;
      } else if (typeof options.from === 'object' && options.from.address) {
        fromEmail = options.from.address;
        if (options.from.name) {
          fromName = options.from.name;
        }
      }
    }
    
    // Create email parameters using the SDK classes
    const sentFrom = new Sender(fromEmail, fromName);
    
    // Build params with the correct chaining methods
    const emailParams = new EmailParams()
      .setFrom(sentFrom)
      .setTo(recipientObjects)
      .setSubject(options.subject || 'Message from TrustBuild')
      .setHtml(typeof options.html === 'string' ? options.html : '');
    
    // Add plain text version if provided
    if (options.text && typeof options.text === 'string') {
      emailParams.setText(options.text);
    }

    // Send with retry logic
    let lastError;
    
    for (let attempt = 0; attempt <= retries; attempt++) {
      try {
        if (attempt > 0) {

        }
        

        // Add more debugging info



        
        const result = await mailerSend.email.send(emailParams);

        
        return {
          messageId: `mailersend_${Date.now()}`,
          envelope: {
            from: fromEmail,
            to: recipientObjects.map(r => r.email)
          }
        };
      } catch (error: any) {
        lastError = error;
        // Improved error logging
        console.error(`❌ MailerSend API send attempt ${attempt + 1} failed:`, error);
        console.error('Error details:', JSON.stringify({
          name: error.name,
          message: error.message,
          stack: error.stack,
          code: error.code,
          status: error.status,
          response: error.response
        }, null, 2));
        
        // Wait before retry (exponential backoff)
        if (attempt < retries) {
          const delay = Math.pow(2, attempt) * 1000;
          await new Promise(resolve => setTimeout(resolve, delay));
        }
      }
    }
    
    // If all MailerSend attempts fail, try nodemailer as fallback

    return sendWithNodemailer(options, retries);
  };
  
  // Send using SendGrid API
  const sendWithSendGrid = async (options: nodemailer.SendMailOptions, retries = 2) => {
    let lastError;
    
    for (let attempt = 0; attempt <= retries; attempt++) {
      try {
        if (attempt > 0) {

        }
        
        // Extract from email and name
        let fromEmail = defaultFromEmail;
        let fromName = defaultFromName;
        
        if (options.from) {
          if (typeof options.from === 'string') {
            fromEmail = options.from;
          } else if (typeof options.from === 'object' && options.from.address) {
            fromEmail = options.from.address;
            if (options.from.name) {
              fromName = options.from.name;
            }
          }
        }
        
        // Parse recipients - handle both string and array formats
        const recipients: string[] = [];
        if (typeof options.to === 'string') {
          recipients.push(options.to);
        } else if (Array.isArray(options.to)) {
          options.to.forEach(recipient => {
            if (typeof recipient === 'string') {
              recipients.push(recipient);
            }
          });
        }
        
        // Prepare SendGrid message - ensure we have valid content
        const htmlContent = typeof options.html === 'string' ? options.html : (options.text || 'This is a message from TrustBuild.');
        const textContent = typeof options.text === 'string' ? options.text : 'This is a message from TrustBuild.';
        
        // Ensure content is not empty
        if (!htmlContent || (typeof htmlContent === 'string' && htmlContent.trim().length === 0)) {
          throw new Error('Email content cannot be empty');
        }
        
        const msg = {
          to: recipients,
          from: {
            email: fromEmail,
            name: fromName
          },
          subject: options.subject || 'Message from TrustBuild',
          text: textContent,
          html: typeof htmlContent === 'string' ? htmlContent : String(htmlContent)
        };
        





        
        const result = await sgMail.send(msg);

        
        return {
          messageId: result[0].headers['x-message-id'] || `sendgrid_${Date.now()}`,
          envelope: {
            from: fromEmail,
            to: recipients
          }
        };
      } catch (error: any) {
        lastError = error;
        console.error(`❌ SendGrid API send attempt ${attempt + 1} failed:`, error);
        console.error('Error details:', JSON.stringify({
          name: error.name,
          message: error.message,
          code: error.code,
          status: error.status,
          response: error.response?.body
        }, null, 2));
        
        // Wait before retry (exponential backoff)
        if (attempt < retries) {
          const delay = Math.pow(2, attempt) * 1000;
          await new Promise(resolve => setTimeout(resolve, delay));
        }
      }
    }
    
    // If all SendGrid attempts fail, try nodemailer as fallback

    return sendWithNodemailer(options, retries);
  };
  
  // Primary method using Nodemailer with Gmail
  const sendWithNodemailer = async (options: nodemailer.SendMailOptions, retries = 2) => {
    let lastError;
    
    for (let attempt = 0; attempt <= retries; attempt++) {
      try {
        if (attempt > 0) {

        }
        
        // First try Gmail if configured
        if (process.env.GMAIL_USER && process.env.GMAIL_APP_PASSWORD) {


          
          // For production environments, try alternative port configuration
          const isProduction = process.env.NODE_ENV === 'production';
          const port = isProduction ? 465 : 587;
          const secure = isProduction ? true : false;
          

          
          const transporter = nodemailer.createTransport({
            host: 'smtp.gmail.com',
            port: port,
            secure: secure, // Use SSL for port 465
            auth: {
              user: process.env.GMAIL_USER,
              pass: process.env.GMAIL_APP_PASSWORD,
            },
            connectionTimeout: 60000, // 60 seconds
            socketTimeout: 60000, // 60 seconds
            debug: true, // Enable debug logging
            tls: {
              rejectUnauthorized: false // Less strict SSL
            }
          });
          
          return await transporter.sendMail(options);
        }
        
        // Use ethereal for testing in development as fallback
        if (process.env.NODE_ENV !== 'production') {

          const testAccount = await nodemailer.createTestAccount();
          
          const transporter = nodemailer.createTransport({
            host: 'smtp.ethereal.email',
            port: 587,
            secure: false,
            auth: {
              user: testAccount.user,
              pass: testAccount.pass,
            },
          });
          
          const info = await transporter.sendMail(options);

          return info;
        }
        
        throw new Error('No email sending method available - Gmail not configured');
      } catch (error: any) {
        lastError = error;
        console.error(`❌ Email fallback send attempt ${attempt + 1} failed:`, error.message);
        console.error(`❌ Error details:`, {
          code: error.code,
          command: error.command,
          name: error.name,
          host: 'smtp.gmail.com',
          port: process.env.NODE_ENV === 'production' ? 465 : 587
        });
        
        // Special handling for connection errors - add helpful suggestions
        if (error.code === 'ETIMEDOUT' || error.code === 'ECONNREFUSED') {
          console.error(`
          ⚠️ IMPORTANT NETWORK ISSUES DETECTED ⚠️
          This is likely due to firewall or network restrictions blocking SMTP traffic.
          Possible solutions:
          1. Check if your hosting provider blocks outbound SMTP traffic
          2. Ask your provider to whitelist smtp.gmail.com on ports 465/587
          3. Consider using an email API service like SendGrid, Mailgun, or AWS SES 
             that uses HTTP requests (port 443) instead of SMTP
          `);
        }
        
        // Wait before retry (exponential backoff)
        if (attempt < retries) {
          const delay = Math.pow(2, attempt) * 1000;
          await new Promise(resolve => setTimeout(resolve, delay));
        }
      }
    }
    
    throw lastError;
  };
  
  return { sendMail };
};

// Helper function to create a standard service notification email
export const createServiceEmail = (options: {
  to: string | string[];
  subject: string;
  heading: string;
  body: string;
  ctaText?: string;
  ctaUrl?: string;
  footerText?: string;
}) => {
  const {
    to,
    subject,
    heading,
    body,
    ctaText,
    ctaUrl,
    footerText
  } = options;

  const htmlContent = `
    <!DOCTYPE html>
    <html>
    <head>
      <style>
        body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; max-width: 600px; margin: 0 auto; }
        .header { background-color: #10b981; color: white; padding: 20px; text-align: center; }
        .content { padding: 20px; }
        .footer { background-color: #f1f5f9; padding: 15px; text-align: center; font-size: 12px; color: #64748b; }
        .button { display: inline-block; background-color: #10b981; color: white; padding: 10px 20px; 
                 text-decoration: none; border-radius: 4px; font-weight: bold; margin: 15px 0; }
      </style>
    </head>
    <body>
      <div class="header">
        <h1>${heading}</h1>
      </div>
      
      <div class="content">
        ${body}
        
        ${ctaText && ctaUrl ? `
        <div style="text-align: center; margin: 25px 0;">
          <a href="${ctaUrl}" class="button">${ctaText}</a>
        </div>
        ` : ''}
      </div>
      
      <div class="footer">
        <p>${footerText || 'TrustBuild - Connecting trusted contractors with customers'}</p>
        <p>© ${new Date().getFullYear()} TrustBuild. All rights reserved.</p>
      </div>
    </body>
    </html>
  `;

  return {
    from: process.env.EMAIL_FROM || 'noreply@trustbuild.uk',
    to,
    subject,
    html: htmlContent,
    text: `TrustBuild Notification\n\n${heading}\n\n${body.replace(/<[^>]*>/g, '')}\n\n${footerText || 'TrustBuild - Connecting trusted contractors with customers'}`
  };
};

// Send test email on server startup
export const sendTestEmail = async () => {
  try {
    const emailService = createEmailService();
    
    // Mail options
    const mailOptions = createServiceEmail({
      to: 'elsajaadammar@gmail.com', // Updated to administrator email
      subject: 'TrustBuild Server Started',
      heading: 'TrustBuild Server Status',
      body: `
        <p>The TrustBuild server has started successfully.</p>
        <ul>
          <li><strong>Environment:</strong> ${process.env.NODE_ENV || 'development'}</li>
          <li><strong>Timestamp:</strong> ${new Date().toISOString()}</li>
          <li><strong>Server:</strong> ${process.env.SERVER_NAME || 'Not specified'}</li>
        </ul>
        <p>This is an automated message sent on server startup.</p>
      `,
      footerText: 'This is an automated message from the TrustBuild system.'
    });
    
    // Send mail with retry logic
    console.log('📧 Sending test email:', {
      to: mailOptions.to,
      subject: mailOptions.subject,
      from: mailOptions.from,
      hasHtml: !!mailOptions.html,
      htmlLength: mailOptions.html ? mailOptions.html.length : 0,
      hasText: !!mailOptions.text,
      textLength: mailOptions.text ? mailOptions.text.length : 0
    });
    const info = await emailService.sendMail(mailOptions);

    return true;
  } catch (error) {
    console.error('❌ All email sending attempts failed:', error);
    return false;
  }
};
