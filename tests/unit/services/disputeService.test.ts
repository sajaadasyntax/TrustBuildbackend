/**
 * Unit tests for Dispute Service
 */

import { 
  mockPrisma, 
  resetMocks, 
  createMockDispute, 
  createMockJob,
  createMockUser 
} from '../utils/testHelpers';

// Mock dependencies
jest.mock('../../../src/config/database', () => ({
  prisma: mockPrisma,
}));

jest.mock('../../../src/services/notificationService', () => ({
  createNotification: jest.fn().mockResolvedValue(true),
}));

import { disputeService } from '../../../src/services/disputeService';
import { DisputeStatus, DisputeResolution, UserRole, JobStatus } from '@prisma/client';

describe('DisputeService', () => {
  beforeEach(() => {
    resetMocks();
    jest.clearAllMocks();
  });

  describe('createDispute', () => {
    it('should create a new dispute and update job status', async () => {
      const mockJob = createMockJob();
      const newDispute = createMockDispute();

      mockPrisma.job.findUnique.mockResolvedValue(mockJob);
      mockPrisma.dispute.create.mockResolvedValue(newDispute);
      mockPrisma.job.update.mockResolvedValue({
        ...mockJob,
        status: JobStatus.DISPUTED,
      });

      const result = await disputeService.createDispute({
        jobId: 'job-123',
        raisedByUserId: 'user-123',
        raisedByRole: UserRole.CUSTOMER,
        type: 'QUALITY_ISSUE' as any,
        title: 'Test Dispute',
        description: 'Test description',
      });

      expect(mockPrisma.job.findUnique).toHaveBeenCalledWith({
        where: { id: 'job-123' },
        include: expect.any(Object),
      });
      expect(mockPrisma.dispute.create).toHaveBeenCalled();
      expect(mockPrisma.job.update).toHaveBeenCalledWith({
        where: { id: 'job-123' },
        data: { status: JobStatus.DISPUTED },
      });
      expect(result).toEqual(newDispute);
    });

    it('should throw error if job not found', async () => {
      mockPrisma.job.findUnique.mockResolvedValue(null);

      await expect(
        disputeService.createDispute({
          jobId: 'non-existent',
          raisedByUserId: 'user-123',
          raisedByRole: UserRole.CUSTOMER,
          type: 'QUALITY_ISSUE' as any,
          title: 'Test',
          description: 'Test',
        })
      ).rejects.toThrow('Job not found');
    });

    it('should include evidence URLs when provided', async () => {
      const mockJob = createMockJob();
      const evidenceUrls = ['https://example.com/evidence1.jpg'];

      mockPrisma.job.findUnique.mockResolvedValue(mockJob);
      mockPrisma.dispute.create.mockResolvedValue(createMockDispute());
      mockPrisma.job.update.mockResolvedValue(mockJob);

      await disputeService.createDispute({
        jobId: 'job-123',
        raisedByUserId: 'user-123',
        raisedByRole: UserRole.CUSTOMER,
        type: 'QUALITY_ISSUE' as any,
        title: 'Test',
        description: 'Test',
        evidenceUrls,
      });

      expect(mockPrisma.dispute.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            evidenceUrls,
          }),
        })
      );
    });
  });

  describe('addResponse', () => {
    it('should add a response and update dispute status to UNDER_REVIEW', async () => {
      const mockResponse = {
        id: 'response-123',
        disputeId: 'dispute-123',
        userId: 'user-123',
        message: 'Test response',
      };

      mockPrisma.disputeResponse.create.mockResolvedValue(mockResponse);
      mockPrisma.dispute.updateMany.mockResolvedValue({ count: 1 });

      const result = await disputeService.addResponse({
        disputeId: 'dispute-123',
        userId: 'user-123',
        userRole: UserRole.CUSTOMER,
        message: 'Test response',
      });

      expect(mockPrisma.disputeResponse.create).toHaveBeenCalled();
      expect(mockPrisma.dispute.updateMany).toHaveBeenCalledWith({
        where: {
          id: 'dispute-123',
          status: DisputeStatus.OPEN,
        },
        data: {
          status: DisputeStatus.UNDER_REVIEW,
        },
      });
      expect(result).toEqual(mockResponse);
    });

    it('should handle internal responses without notifying other party', async () => {
      const mockResponse = {
        id: 'response-123',
        isInternal: true,
      };

      mockPrisma.disputeResponse.create.mockResolvedValue(mockResponse);
      mockPrisma.dispute.updateMany.mockResolvedValue({ count: 1 });

      await disputeService.addResponse({
        disputeId: 'dispute-123',
        userId: 'admin-123',
        userRole: UserRole.ADMIN,
        message: 'Internal note',
        isInternal: true,
      });

      expect(mockPrisma.disputeResponse.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            isInternal: true,
          }),
        })
      );
    });
  });

  describe('resolveDispute', () => {
    it('should resolve dispute and update job status', async () => {
      const mockDispute = createMockDispute();
      const resolvedDispute = {
        ...mockDispute,
        status: DisputeStatus.RESOLVED,
        resolution: DisputeResolution.FAVOR_CUSTOMER,
      };

      mockPrisma.dispute.findUnique.mockResolvedValue(mockDispute);
      mockPrisma.$transaction.mockImplementation(async (callback) => {
        return callback(mockPrisma);
      });
      mockPrisma.dispute.update.mockResolvedValue(resolvedDispute);
      mockPrisma.job.update.mockResolvedValue(mockDispute.job);

      const result = await disputeService.resolveDispute({
        disputeId: 'dispute-123',
        adminId: 'admin-123',
        resolution: DisputeResolution.FAVOR_CUSTOMER,
        resolutionNotes: 'Customer was right',
      });

      expect(mockPrisma.dispute.update).toHaveBeenCalledWith({
        where: { id: 'dispute-123' },
        data: expect.objectContaining({
          status: DisputeStatus.RESOLVED,
          resolution: DisputeResolution.FAVOR_CUSTOMER,
          resolvedByAdminId: 'admin-123',
        }),
      });
    });

    it('should refund credits when specified', async () => {
      const mockDispute = createMockDispute({
        job: createMockJob({
          jobAccess: [{
            contractorId: 'contractor-123',
            creditUsed: true,
          }],
        }),
      });

      mockPrisma.dispute.findUnique.mockResolvedValue(mockDispute);
      mockPrisma.$transaction.mockImplementation(async (callback) => {
        return callback(mockPrisma);
      });
      mockPrisma.dispute.update.mockResolvedValue(mockDispute);
      mockPrisma.contractor.update.mockResolvedValue({});
      mockPrisma.creditTransaction.create.mockResolvedValue({});
      mockPrisma.job.update.mockResolvedValue({});

      await disputeService.resolveDispute({
        disputeId: 'dispute-123',
        adminId: 'admin-123',
        resolution: DisputeResolution.FAVOR_CUSTOMER,
        resolutionNotes: 'Refunding credits',
        refundCredits: true,
        creditAmount: 1,
      });

      expect(mockPrisma.contractor.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            creditsBalance: { increment: 1 },
          }),
        })
      );
      expect(mockPrisma.creditTransaction.create).toHaveBeenCalled();
    });

    it('should throw error if dispute not found', async () => {
      mockPrisma.dispute.findUnique.mockResolvedValue(null);

      await expect(
        disputeService.resolveDispute({
          disputeId: 'non-existent',
          adminId: 'admin-123',
          resolution: DisputeResolution.FAVOR_CUSTOMER,
          resolutionNotes: 'Test',
        })
      ).rejects.toThrow('Dispute not found');
    });
  });

  describe('getDisputesForAdmin', () => {
    it('should fetch all disputes without filters', async () => {
      const mockDisputes = [createMockDispute(), createMockDispute({ id: 'dispute-456' })];

      mockPrisma.dispute.findMany.mockResolvedValue(mockDisputes);

      const result = await disputeService.getDisputesForAdmin();

      expect(mockPrisma.dispute.findMany).toHaveBeenCalledWith({
        where: {},
        include: expect.any(Object),
        orderBy: expect.any(Array),
      });
      expect(result).toEqual(mockDisputes);
    });

    it('should filter disputes by status', async () => {
      mockPrisma.dispute.findMany.mockResolvedValue([]);

      await disputeService.getDisputesForAdmin({
        status: DisputeStatus.OPEN,
      });

      expect(mockPrisma.dispute.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { status: DisputeStatus.OPEN },
        })
      );
    });

    it('should search disputes by title or description', async () => {
      mockPrisma.dispute.findMany.mockResolvedValue([]);

      await disputeService.getDisputesForAdmin({
        search: 'quality',
      });

      expect(mockPrisma.dispute.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            OR: expect.arrayContaining([
              { title: { contains: 'quality', mode: 'insensitive' } },
              { description: { contains: 'quality', mode: 'insensitive' } },
            ]),
          }),
        })
      );
    });
  });

  describe('getDisputeStats', () => {
    it('should return dispute statistics', async () => {
      mockPrisma.dispute.count
        .mockResolvedValueOnce(10)  // totalDisputes
        .mockResolvedValueOnce(3)   // openDisputes
        .mockResolvedValueOnce(7);  // resolvedDisputes
      
      mockPrisma.dispute.groupBy.mockResolvedValue([
        { type: 'QUALITY_ISSUE', _count: 5 },
        { type: 'PAYMENT_DISPUTE', _count: 3 },
      ]);

      const result = await disputeService.getDisputeStats();

      expect(result).toEqual({
        totalDisputes: 10,
        openDisputes: 3,
        resolvedDisputes: 7,
        byType: expect.any(Array),
      });
    });
  });
});

