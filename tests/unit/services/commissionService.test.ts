/**
 * Unit tests for Commission Service
 */

import { 
  mockPrisma, 
  resetMocks, 
  createMockJob, 
  createMockContractor,
  createMockCommissionPayment 
} from '../utils/testHelpers';

// Mock dependencies
jest.mock('../../../src/config/database', () => ({
  prisma: mockPrisma,
}));

jest.mock('../../../src/services/emailService', () => ({
  createEmailService: jest.fn(() => ({
    sendMail: jest.fn().mockResolvedValue(true),
  })),
  createServiceEmail: jest.fn(() => ({})),
}));

jest.mock('../../../src/services/emailNotificationService', () => ({
  sendCommissionInvoiceEmail: jest.fn().mockResolvedValue(true),
}));

jest.mock('../../../src/services/notificationService', () => ({
  createCommissionDueNotification: jest.fn().mockResolvedValue(true),
  createAccountSuspendedNotification: jest.fn().mockResolvedValue(true),
}));

jest.mock('../../../src/services/settingsService', () => ({
  getCommissionRate: jest.fn().mockResolvedValue(15),
}));

import { 
  processCommissionForJob, 
  processCommissionReminders,
  checkSubscriptionCommissionEligibility,
  getSubscriptionPricing 
} from '../../../src/services/commissionService';

describe('CommissionService', () => {
  beforeEach(() => {
    resetMocks();
    jest.clearAllMocks();
  });

  describe('processCommissionForJob', () => {
    it('should create commission payment when contractor used credits', async () => {
      const mockJob = createMockJob({
        id: 'job-123',
        wonByContractorId: 'contractor-123',
        commissionPaid: false,
        jobAccess: [{
          contractorId: 'contractor-123',
          creditUsed: true,
          usedFreePoint: false,
        }],
      });

      mockPrisma.job.findUnique.mockResolvedValue(mockJob);
      mockPrisma.commissionPayment.create.mockResolvedValue({
        id: 'commission-123',
        totalAmount: 150,
      });
      mockPrisma.commissionInvoice.create.mockResolvedValue({
        id: 'invoice-123',
        invoiceNumber: 'COMM-123',
      });
      mockPrisma.job.update.mockResolvedValue(mockJob);

      await processCommissionForJob('job-123', 1000);

      expect(mockPrisma.job.findUnique).toHaveBeenCalledWith({
        where: { id: 'job-123' },
        include: expect.any(Object),
      });
      expect(mockPrisma.commissionPayment.create).toHaveBeenCalled();
      expect(mockPrisma.commissionInvoice.create).toHaveBeenCalled();
      expect(mockPrisma.job.update).toHaveBeenCalledWith({
        where: { id: 'job-123' },
        data: { commissionPaid: true },
      });
    });

    it('should create commission payment when contractor used free trial point', async () => {
      const mockJob = createMockJob({
        id: 'job-123',
        wonByContractorId: 'contractor-123',
        commissionPaid: false,
        jobAccess: [{
          contractorId: 'contractor-123',
          creditUsed: false,
          usedFreePoint: true,
        }],
      });

      mockPrisma.job.findUnique.mockResolvedValue(mockJob);
      mockPrisma.commissionPayment.create.mockResolvedValue({
        id: 'commission-123',
        totalAmount: 150,
      });
      mockPrisma.commissionInvoice.create.mockResolvedValue({
        id: 'invoice-123',
        invoiceNumber: 'COMM-123',
      });
      mockPrisma.job.update.mockResolvedValue(mockJob);

      await processCommissionForJob('job-123', 1000);

      expect(mockPrisma.commissionPayment.create).toHaveBeenCalled();
    });

    it('should not create commission if already paid', async () => {
      const mockJob = createMockJob({
        commissionPaid: true,
        jobAccess: [{ creditUsed: true }],
      });

      mockPrisma.job.findUnique.mockResolvedValue(mockJob);

      await processCommissionForJob('job-123', 1000);

      expect(mockPrisma.commissionPayment.create).not.toHaveBeenCalled();
    });

    it('should not create commission if contractor did not use credits or free point', async () => {
      const mockJob = createMockJob({
        commissionPaid: false,
        jobAccess: [{
          creditUsed: false,
          usedFreePoint: false,
        }],
      });

      mockPrisma.job.findUnique.mockResolvedValue(mockJob);

      await processCommissionForJob('job-123', 1000);

      expect(mockPrisma.commissionPayment.create).not.toHaveBeenCalled();
    });

    it('should handle missing job gracefully', async () => {
      mockPrisma.job.findUnique.mockResolvedValue(null);

      await processCommissionForJob('non-existent-job', 1000);

      expect(mockPrisma.commissionPayment.create).not.toHaveBeenCalled();
    });
  });

  describe('processCommissionReminders', () => {
    it('should mark commission as overdue and suspend contractor when past due date', async () => {
      const pastDueDate = new Date(Date.now() - 24 * 60 * 60 * 1000);
      const mockCommission = createMockCommissionPayment({
        status: 'PENDING',
        dueDate: pastDueDate,
      });

      mockPrisma.commissionPayment.findMany.mockResolvedValue([mockCommission]);
      mockPrisma.$transaction.mockImplementation(async (callback) => {
        return callback(mockPrisma);
      });
      mockPrisma.commissionPayment.update.mockResolvedValue({
        ...mockCommission,
        status: 'OVERDUE',
      });
      mockPrisma.contractor.update.mockResolvedValue({
        ...mockCommission.contractor,
        status: 'SUSPENDED',
      });

      await processCommissionReminders();

      expect(mockPrisma.commissionPayment.update).toHaveBeenCalledWith({
        where: { id: mockCommission.id },
        data: { status: 'OVERDUE' },
      });
      expect(mockPrisma.contractor.update).toHaveBeenCalledWith({
        where: { id: mockCommission.contractorId },
        data: { status: 'SUSPENDED' },
      });
    });

    it('should send reminders when approaching due date', async () => {
      const upcomingDueDate = new Date(Date.now() + 12 * 60 * 60 * 1000);
      const mockCommission = createMockCommissionPayment({
        status: 'PENDING',
        dueDate: upcomingDueDate,
        remindersSent: 0,
        invoice: {
          id: 'invoice-123',
          invoiceNumber: 'COMM-123',
        },
      });

      mockPrisma.commissionPayment.findMany.mockResolvedValue([mockCommission]);
      mockPrisma.commissionPayment.update.mockResolvedValue({
        ...mockCommission,
        remindersSent: 1,
      });

      await processCommissionReminders();

      expect(mockPrisma.commissionPayment.update).toHaveBeenCalledWith({
        where: { id: mockCommission.id },
        data: expect.objectContaining({
          remindersSent: expect.any(Number),
          lastReminderSent: expect.any(Date),
        }),
      });
    });
  });

  describe('checkSubscriptionCommissionEligibility', () => {
    it('should return true for active subscription within period', async () => {
      const mockContractor = createMockContractor({
        subscription: {
          isActive: true,
          status: 'active',
          currentPeriodStart: new Date(Date.now() - 10 * 24 * 60 * 60 * 1000),
          currentPeriodEnd: new Date(Date.now() + 20 * 24 * 60 * 60 * 1000),
        },
      });

      mockPrisma.contractor.findUnique.mockResolvedValue(mockContractor);

      const result = await checkSubscriptionCommissionEligibility('contractor-123');

      expect(result).toBe(true);
    });

    it('should return false for inactive subscription', async () => {
      const mockContractor = createMockContractor({
        subscription: {
          isActive: false,
          status: 'canceled',
          currentPeriodStart: new Date(),
          currentPeriodEnd: new Date(),
        },
      });

      mockPrisma.contractor.findUnique.mockResolvedValue(mockContractor);

      const result = await checkSubscriptionCommissionEligibility('contractor-123');

      expect(result).toBe(false);
    });

    it('should return false for contractor without subscription', async () => {
      const mockContractor = createMockContractor({
        subscription: null,
      });

      mockPrisma.contractor.findUnique.mockResolvedValue(mockContractor);

      const result = await checkSubscriptionCommissionEligibility('contractor-123');

      expect(result).toBe(false);
    });
  });

  describe('getSubscriptionPricing', () => {
    it('should calculate monthly pricing correctly', () => {
      const pricing = getSubscriptionPricing('MONTHLY');
      
      expect(pricing.monthly).toBe(49.99);
      expect(pricing.total).toBe(49.99);
      expect(pricing.savings).toBeUndefined();
    });

    it('should calculate 6-month pricing with 10% discount', () => {
      const pricing = getSubscriptionPricing('SIX_MONTHS');
      
      expect(pricing.monthly).toBeCloseTo(44.99, 2);
      expect(pricing.total).toBeCloseTo(269.94, 2);
      expect(pricing.savings).toBeCloseTo(29.94, 2);
    });

    it('should calculate yearly pricing with 20% discount', () => {
      const pricing = getSubscriptionPricing('YEARLY');
      
      expect(pricing.monthly).toBeCloseTo(39.99, 2);
      expect(pricing.total).toBeCloseTo(479.90, 2);
      expect(pricing.savings).toBeCloseTo(119.98, 2);
    });

    it('should default to monthly for unknown plans', () => {
      const pricing = getSubscriptionPricing('UNKNOWN');
      
      expect(pricing.monthly).toBe(49.99);
      expect(pricing.total).toBe(49.99);
    });
  });
});

