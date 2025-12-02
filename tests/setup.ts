/**
 * Jest setup file for backend tests
 */

// Mock environment variables for testing
process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'test-jwt-secret-key-for-testing';
process.env.DATABASE_URL = process.env.TEST_DATABASE_URL || 'postgresql://test:test@localhost:5432/trustbuild_test';
process.env.PORT = '3001';

// Increase timeout for database operations
jest.setTimeout(30000);

// Global test utilities
global.console = {
  ...console,
  // Suppress console logs during tests (optional - can be enabled for debugging)
  log: jest.fn(),
  debug: jest.fn(),
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
};

