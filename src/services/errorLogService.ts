import { prisma } from '../config/database';
import { Request } from 'express';

interface ErrorLogData {
  level: 'ERROR' | 'WARNING' | 'INFO';
  source: string;
  message: string;
  stack?: string;
  endpoint?: string;
  method?: string;
  statusCode?: number;
  userId?: string;
  metadata?: any;
}

/**
 * Log an error to the database
 * This function should never throw errors - it's used for logging
 */
export const logError = async (error: any, req?: Request, additionalData?: any): Promise<void> => {
  try {
    // Determine error level
    let level: 'ERROR' | 'WARNING' | 'INFO' = 'ERROR';
    if (error.statusCode && error.statusCode < 500) {
      level = 'WARNING';
    }

    // Extract error details
    let message = error.message || String(error) || 'Unknown error';
    const stack = error.stack || undefined;
    let statusCode = error.statusCode || error.status || undefined;
    
    // Handle errors with nested response.errors array (common in API clients like axios)
    if (error.response && error.response.errors && Array.isArray(error.response.errors)) {
      const nestedMessages = error.response.errors
        .map((err: any) => err.message || err)
        .filter((msg: string) => msg)
        .join('; ');
      if (nestedMessages) {
        message = `${message} - ${nestedMessages}`;
      }
      // Use the response status code if available
      if (error.response.status && !statusCode) {
        statusCode = error.response.status;
      }
    }
    
    // Handle Stripe errors specifically
    if (error.type && error.type.startsWith('Stripe')) {
      message = `Stripe Error: ${message}`;
      if (error.code) {
        message += ` (Code: ${error.code})`;
      }
    }

    // Determine source
    let source = 'unknown';
    if (req?.route?.path) {
      source = `api:${req.route.path}`;
    } else if (req?.path) {
      source = `api:${req.path}`;
    } else if (error.source) {
      source = error.source;
    } else if (error.name) {
      source = error.name.toLowerCase();
    }

    // Extract user ID if available
    let userId: string | undefined;
    if (req && (req as any).user?.id) {
      userId = (req as any).user.id;
    } else if (req && (req as any).admin?.id) {
      userId = (req as any).admin.id;
    }

    // Build metadata
    const metadata: any = {
      ...additionalData,
      errorName: error.name,
      errorCode: error.code,
    };

    if (req) {
      metadata.query = req.query;
      metadata.body = req.body;
      metadata.ip = req.ip || req.socket.remoteAddress;
      metadata.userAgent = req.get('user-agent');
    }

    // Log to database
    await prisma.errorLog.create({
      data: {
        level,
        source,
        message: message.substring(0, 10000), // Limit message length
        stack: stack ? stack.substring(0, 50000) : undefined, // Limit stack length
        endpoint: req?.originalUrl || req?.url,
        method: req?.method,
        statusCode,
        userId,
        metadata: Object.keys(metadata).length > 0 ? metadata : undefined,
      },
    });
  } catch (logError) {
    // Silently fail - we don't want error logging to break the application
    console.error('Failed to log error to database:', logError);
  }
};

/**
 * Log a warning
 */
export const logWarning = async (
  message: string,
  source: string,
  req?: Request,
  metadata?: any
): Promise<void> => {
  try {
    await prisma.errorLog.create({
      data: {
        level: 'WARNING',
        source,
        message,
        endpoint: req?.originalUrl || req?.url,
        method: req?.method,
        userId: (req as any)?.user?.id || (req as any)?.admin?.id,
        metadata,
      },
    });
  } catch (error) {
    console.error('Failed to log warning:', error);
  }
};

/**
 * Log an info message
 */
export const logInfo = async (
  message: string,
  source: string,
  req?: Request,
  metadata?: any
): Promise<void> => {
  try {
    await prisma.errorLog.create({
      data: {
        level: 'INFO',
        source,
        message,
        endpoint: req?.originalUrl || req?.url,
        method: req?.method,
        userId: (req as any)?.user?.id || (req as any)?.admin?.id,
        metadata,
      },
    });
  } catch (error) {
    console.error('Failed to log info:', error);
  }
};

