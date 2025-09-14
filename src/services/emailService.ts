import nodemailer from 'nodemailer';
import { MailerSend, EmailParams, Sender, Recipient } from 'mailersend';
import sgMail from '@sendgrid/mail';

// Email service with API-based sending
export const createEmailService = () => {
  // Initialize email configuration
  const defaultFromEmail = process.env.EMAIL_FROM || 'noreply@trustbuild.uk';
  const defaultFromName = process.env.EMAIL_FROM_NAME || 'TrustBuild';
  
  // Initialize SendGrid
  const sendGridApiKey = process.env.SENDGRID_API_KEY;
  if (sendGridApiKey) {
    sgMail.setApiKey(sendGridApiKey);
    console.log('✅ SendGrid API key configured');
  } else {
    console.log('⚠️ SendGrid API key not found, will use fallback methods');
  }
  
  // Send email with retry logic and fallbacks
  const sendMail = async (options: nodemailer.SendMailOptions, retries = 2) => {
    try {
      // Try SendGrid first if API key is available
      if (sendGridApiKey) {
        return await sendWithSendGrid(options, retries);
      }
      // Fallback to nodemailer with Gmail configuration
      return await sendWithNodemailer(options, retries);
    } catch (error: any) {
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
          console.log(`📨 MailerSend API retry attempt ${attempt} for email to: ${options.to}`);
        }
        
        console.log(`✅ Sending via MailerSend API to: ${options.to}`);
        // Add more debugging info
        console.log('MailerSend API Token length:', apiToken ? apiToken.length : 0);
        console.log('MailerSend client instance:', Object.keys(mailerSend));
        console.log('MailerSend email property:', mailerSend.email ? 'exists' : 'missing');
        
        const result = await mailerSend.email.send(emailParams);
        console.log('✅ MailerSend API success:', result);
        
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
    console.log('⚠️ All MailerSend API attempts failed, trying Nodemailer fallback...');
    return sendWithNodemailer(options, retries);
  };
  
  // Send using SendGrid API
  const sendWithSendGrid = async (options: nodemailer.SendMailOptions, retries = 2) => {
    let lastError;
    
    for (let attempt = 0; attempt <= retries; attempt++) {
      try {
        if (attempt > 0) {
          console.log(`📨 SendGrid retry attempt ${attempt} for email to: ${options.to}`);
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
        
        console.log(`✅ Sending via SendGrid API to: ${recipients.join(', ')}`);
        console.log(`✅ From: ${fromName} <${fromEmail}>`);
        console.log(`✅ Subject: ${msg.subject}`);
        console.log(`✅ HTML content length: ${msg.html && typeof msg.html === 'string' ? msg.html.length : 0}`);
        console.log(`✅ Text content length: ${msg.text ? msg.text.length : 0}`);
        
        const result = await sgMail.send(msg);
        console.log('✅ SendGrid API success:', result[0].statusCode);
        
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
    console.log('⚠️ All SendGrid API attempts failed, trying Nodemailer fallback...');
    return sendWithNodemailer(options, retries);
  };
  
  // Primary method using Nodemailer with Gmail
  const sendWithNodemailer = async (options: nodemailer.SendMailOptions, retries = 2) => {
    let lastError;
    
    for (let attempt = 0; attempt <= retries; attempt++) {
      try {
        if (attempt > 0) {
          console.log(`📨 Nodemailer retry attempt ${attempt} for email to: ${options.to}`);
        }
        
        // First try Gmail if configured
        if (process.env.GMAIL_USER && process.env.GMAIL_APP_PASSWORD) {
          console.log(`✅ Using Gmail for email: ${process.env.GMAIL_USER}`);
          console.log(`✅ App password length: ${process.env.GMAIL_APP_PASSWORD ? process.env.GMAIL_APP_PASSWORD.length : 0} chars`);
          
          // For production environments, try alternative port configuration
          const isProduction = process.env.NODE_ENV === 'production';
          const port = isProduction ? 465 : 587;
          const secure = isProduction ? true : false;
          
          console.log(`📧 Using SMTP config: port ${port}, secure: ${secure}, environment: ${process.env.NODE_ENV}`);
          
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
          console.log(`⚠️ Using ethereal test account (Gmail not configured)`);
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
          console.log(`📧 Test email preview: ${nodemailer.getTestMessageUrl(info)}`);
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
    console.log(`📧 Attempting to send test email to: ${mailOptions.to}`);
    console.log(`📧 Email options:`, {
      to: mailOptions.to,
      subject: mailOptions.subject,
      from: mailOptions.from,
      hasHtml: !!mailOptions.html,
      htmlLength: mailOptions.html ? mailOptions.html.length : 0,
      hasText: !!mailOptions.text,
      textLength: mailOptions.text ? mailOptions.text.length : 0
    });
    const info = await emailService.sendMail(mailOptions);
    console.log('✉️ Test email sent successfully!', info.messageId);
    return true;
  } catch (error) {
    console.error('❌ All email sending attempts failed:', error);
    return false;
  }
};
