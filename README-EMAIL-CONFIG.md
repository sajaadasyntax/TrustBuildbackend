# TrustBuild Email Configuration Guide

This guide explains how to configure the email sending functionality in the TrustBuild backend.

## Email Service Architecture

The TrustBuild email service uses Gmail SMTP as the primary method for sending emails, with a fallback to Ethereal Email for development environments:

1. **Primary Method**: Gmail SMTP
2. **Fallback Method**: Ethereal Email (for development/testing environments)

## Required Environment Variables

To properly configure email functionality, add these variables to your `.env` file:

```
# Gmail SMTP Configuration (Primary Method)
GMAIL_USER=your-gmail@gmail.com
GMAIL_APP_PASSWORD=your_app_password_not_regular_password

# Email Sender Details (Optional)
EMAIL_FROM=noreply@yourdomain.com
EMAIL_FROM_NAME=Your Service Name
```

## Setting Up Gmail SMTP

To set up Gmail as your email provider:

1. Use a Gmail account dedicated for your application
2. Enable 2-factor authentication on the account
3. Generate an App Password: Google Account → Security → App Passwords
4. Add the Gmail address and App Password to your environment variables

**Important Notes:**
- Use an App Password, not your regular Gmail password
- The account should have 2FA enabled
- Consider using a dedicated Gmail account for your application

## Ethereal Test Account (Development Only)

For development environments, if Gmail is not configured, the system automatically creates an Ethereal test account. These emails are never delivered but can be viewed in a web interface (link provided in the console output).

## Troubleshooting

If emails are not being sent:

1. Check the server logs for error messages
2. Verify that your Gmail App Password is correct
3. Ensure you're using an App Password, not your regular Gmail password
4. Check if your Gmail account has any sending limits or restrictions
5. If on a hosted server, ensure outbound connections are allowed

## Testing Email Functionality

The system automatically sends a test email on server startup. You can modify this behavior in `src/services/emailService.ts` if needed.

To manually test email sending, use the `/api/test/send-email` endpoint (available in development mode only).