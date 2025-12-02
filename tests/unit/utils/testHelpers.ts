/**
 * Test helper utilities for unit tests
 */

import { PrismaClient } from '@prisma/client';

// Mock Prisma client for unit tests
export const mockPrisma = {
  user: {
    findUnique: jest.fn(),
    findMany: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
    delete: jest.fn(),
  },
  job: {
    findUnique: jest.fn(),
    findMany: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
    updateMany: jest.fn(),
  },
  contractor: {
    findUnique: jest.fn(),
    findMany: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
  },
  customer: {
    findUnique: jest.fn(),
    findMany: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
  },
  dispute: {
    findUnique: jest.fn(),
    findMany: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
    updateMany: jest.fn(),
    groupBy: jest.fn(),
    count: jest.fn(),
  },
  disputeResponse: {
    create: jest.fn(),
  },
  commissionPayment: {
    findUnique: jest.fn(),
    findMany: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
    updateMany: jest.fn(),
  },
  commissionInvoice: {
    create: jest.fn(),
  },
  creditTransaction: {
    create: jest.fn(),
  },
  $transaction: jest.fn((callback) => callback(mockPrisma)),
};

// Mock user factory
export const createMockUser = (overrides = {}) => ({
  id: 'user-123',
  email: 'test@example.com',
  name: 'Test User',
  role: 'CUSTOMER',
  emailVerified: true,
  createdAt: new Date(),
  updatedAt: new Date(),
  ...overrides,
});

// Mock contractor factory
export const createMockContractor = (overrides = {}) => ({
  id: 'contractor-123',
  userId: 'user-123',
  businessName: 'Test Contractor',
  status: 'ACTIVE',
  creditsBalance: 10,
  user: createMockUser({ role: 'CONTRACTOR' }),
  subscription: {
    id: 'sub-123',
    isActive: true,
    status: 'active',
    currentPeriodStart: new Date(),
    currentPeriodEnd: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
  },
  ...overrides,
});

// Mock customer factory
export const createMockCustomer = (overrides = {}) => ({
  id: 'customer-123',
  userId: 'user-456',
  user: createMockUser({ id: 'user-456', role: 'CUSTOMER' }),
  ...overrides,
});

// Mock job factory
export const createMockJob = (overrides = {}) => ({
  id: 'job-123',
  title: 'Test Job',
  description: 'Test job description',
  customerId: 'customer-123',
  wonByContractorId: 'contractor-123',
  status: 'IN_PROGRESS',
  budget: 1000,
  commissionPaid: false,
  customerConfirmed: false,
  createdAt: new Date(),
  updatedAt: new Date(),
  customer: createMockCustomer(),
  wonByContractor: createMockContractor(),
  jobAccess: [],
  ...overrides,
});

// Mock dispute factory
export const createMockDispute = (overrides = {}) => ({
  id: 'dispute-123',
  jobId: 'job-123',
  raisedByUserId: 'user-123',
  raisedByRole: 'CUSTOMER',
  type: 'QUALITY_ISSUE',
  title: 'Test Dispute',
  description: 'Test dispute description',
  status: 'OPEN',
  priority: 'MEDIUM',
  evidenceUrls: [],
  createdAt: new Date(),
  updatedAt: new Date(),
  job: createMockJob(),
  responses: [],
  ...overrides,
});

// Mock commission payment factory
export const createMockCommissionPayment = (overrides = {}) => ({
  id: 'commission-123',
  jobId: 'job-123',
  contractorId: 'contractor-123',
  customerId: 'customer-123',
  finalJobAmount: 1000,
  commissionRate: 15,
  commissionAmount: 150,
  vatAmount: 0,
  totalAmount: 150,
  status: 'PENDING',
  dueDate: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
  remindersSent: 0,
  lastReminderSent: null,
  createdAt: new Date(),
  updatedAt: new Date(),
  contractor: createMockContractor(),
  job: createMockJob(),
  invoice: null,
  ...overrides,
});

// Reset all mocks
export const resetMocks = () => {
  Object.values(mockPrisma).forEach((model: any) => {
    if (typeof model === 'object') {
      Object.values(model).forEach((method: any) => {
        if (typeof method === 'function' && method.mockReset) {
          method.mockReset();
        }
      });
    }
    if (typeof model === 'function' && model.mockReset) {
      model.mockReset();
    }
  });
};

