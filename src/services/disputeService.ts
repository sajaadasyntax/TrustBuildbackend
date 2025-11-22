import { PrismaClient, DisputeType, DisputeStatus, DisputeResolution, UserRole, JobStatus } from '@prisma/client';
import { createNotification } from './notificationService';

const prisma = new PrismaClient();

export const disputeService = {
  /**
   * Create a new dispute
   */
  async createDispute(data: {
    jobId: string;
    raisedByUserId: string;
    raisedByRole: UserRole;
    type: DisputeType;
    title: string;
    description: string;
    evidenceUrls?: string[];
    priority?: string;
  }) {
    // Check if job exists
    const job = await prisma.job.findUnique({
      where: { id: data.jobId },
      include: {
        customer: { include: { user: true } },
        wonByContractor: { include: { user: true } },
      },
    });

    if (!job) {
      throw new Error('Job not found');
    }

    // Create dispute
    const dispute = await prisma.dispute.create({
      data: {
        jobId: data.jobId,
        raisedByUserId: data.raisedByUserId,
        raisedByRole: data.raisedByRole,
        type: data.type,
        title: data.title,
        description: data.description,
        evidenceUrls: data.evidenceUrls || [],
        priority: data.priority || 'MEDIUM',
      },
      include: {
        job: {
          include: {
            customer: { include: { user: true } },
            wonByContractor: { include: { user: true } },
          },
        },
      },
    });

    // Update job status to DISPUTED
    await prisma.job.update({
      where: { id: data.jobId },
      data: { status: JobStatus.DISPUTED },
    });

    // Send notifications
    await this.notifyDisputeCreated(dispute);

    return dispute;
  },

  /**
   * Add a response to a dispute
   */
  async addResponse(data: {
    disputeId: string;
    userId: string;
    userRole: UserRole;
    message: string;
    attachments?: string[];
    isInternal?: boolean;
  }) {
    const response = await prisma.disputeResponse.create({
      data: {
        disputeId: data.disputeId,
        userId: data.userId,
        userRole: data.userRole,
        message: data.message,
        attachments: data.attachments || [],
        isInternal: data.isInternal || false,
      },
    });

    // Update dispute status to UNDER_REVIEW if it was OPEN
    await prisma.dispute.updateMany({
      where: {
        id: data.disputeId,
        status: DisputeStatus.OPEN,
      },
      data: {
        status: DisputeStatus.UNDER_REVIEW,
      },
    });

    // Send notification to other party
    if (!data.isInternal) {
      await this.notifyNewResponse(data.disputeId, data.userId);
    }

    return response;
  },

  /**
   * Resolve a dispute (admin only)
   */
  async resolveDispute(data: {
    disputeId: string;
    adminId: string;
    resolution: DisputeResolution;
    resolutionNotes: string;
    refundCredits?: boolean;
    creditAmount?: number;
    adjustCommission?: boolean;
    commissionAmount?: number;
    completeJob?: boolean;
  }) {
    const dispute = await prisma.dispute.findUnique({
      where: { id: data.disputeId },
      include: {
        job: {
          include: {
            customer: { include: { user: true } },
            wonByContractor: { include: { user: true } },
            jobAccess: {
              include: { contractor: true },
            },
          },
        },
      },
    });

    if (!dispute) {
      throw new Error('Dispute not found');
    }

    // Start a transaction to handle all updates
    const result = await prisma.$transaction(async (tx) => {
      // Update dispute
      const updatedDispute = await tx.dispute.update({
        where: { id: data.disputeId },
        data: {
          status: DisputeStatus.RESOLVED,
          resolution: data.resolution,
          resolutionNotes: data.resolutionNotes,
          resolvedByAdminId: data.adminId,
          resolvedAt: new Date(),
          creditRefunded: data.refundCredits || false,
          creditRefundAmount: data.creditAmount || null,
          commissionAdjusted: data.adjustCommission || false,
          commissionAmount: data.commissionAmount || null,
          jobCompletedOverride: data.completeJob || false,
        },
      });

      // Handle credit refund
      if (data.refundCredits && data.creditAmount && dispute.job.wonByContractor) {
        const contractor = dispute.job.wonByContractor;
        
        // Find the job access record to refund
        const jobAccess = dispute.job.jobAccess.find(
          (access) => access.contractorId === contractor.id && access.creditUsed
        );

        if (jobAccess) {
          // Refund credits
          await tx.contractor.update({
            where: { id: contractor.id },
            data: {
              creditsBalance: {
                increment: data.creditAmount,
              },
            },
          });

          // Create credit transaction
          await tx.creditTransaction.create({
            data: {
              contractorId: contractor.id,
              amount: data.creditAmount,
              type: 'DISPUTE_REFUND',
              description: `Credit refunded for dispute: ${dispute.title}`,
              jobId: dispute.jobId,
              adminUserId: data.adminId,
            },
          });
        }
      }

      // Handle commission adjustment
      if (data.adjustCommission && data.commissionAmount) {
        const commissionPayment = await tx.commissionPayment.findUnique({
          where: { jobId: dispute.jobId },
        });

        if (commissionPayment) {
          await tx.commissionPayment.update({
            where: { id: commissionPayment.id },
            data: {
              commissionAmount: data.commissionAmount,
              totalAmount: data.commissionAmount,
            },
          });
        }
      }

      // Handle job completion override
      if (data.completeJob) {
        await tx.job.update({
          where: { id: dispute.jobId },
          data: {
            status: JobStatus.COMPLETED,
            customerConfirmed: true,
            adminOverrideAt: new Date(),
            adminOverrideBy: data.adminId,
          },
        });
      } else {
        // Just update job status back to previous state
        await tx.job.update({
          where: { id: dispute.jobId },
          data: {
            status: dispute.job.contractorProposedAmount 
              ? JobStatus.AWAITING_FINAL_PRICE_CONFIRMATION 
              : JobStatus.IN_PROGRESS,
          },
        });
      }

      return updatedDispute;
    });

    // Send notifications to involved parties
    await this.notifyDisputeResolved(dispute.id);

    return result;
  },

  /**
   * Update dispute status
   */
  async updateDisputeStatus(disputeId: string, status: DisputeStatus) {
    return await prisma.dispute.update({
      where: { id: disputeId },
      data: { status },
    });
  },

  /**
   * Get disputes for admin dashboard
   */
  async getDisputesForAdmin(filters?: {
    status?: DisputeStatus;
    type?: DisputeType;
    priority?: string;
    search?: string;
  }) {
    const where: any = {};

    if (filters?.status) {
      where.status = filters.status;
    }

    if (filters?.type) {
      where.type = filters.type;
    }

    if (filters?.priority) {
      where.priority = filters.priority;
    }

    if (filters?.search) {
      where.OR = [
        { title: { contains: filters.search, mode: 'insensitive' } },
        { description: { contains: filters.search, mode: 'insensitive' } },
      ];
    }

    const disputes = await prisma.dispute.findMany({
      where,
      include: {
        job: {
          include: {
            customer: { include: { user: true } },
            wonByContractor: { include: { user: true } },
            service: true,
          },
        },
        responses: {
          orderBy: { createdAt: 'asc' },
          take: 1, // Just get first response for preview
        },
      },
      orderBy: [
        { status: 'asc' }, // OPEN first
        { createdAt: 'desc' },
      ],
    });

    return disputes;
  },

  /**
   * Get single dispute details
   */
  async getDisputeDetails(disputeId: string) {
    const dispute = await prisma.dispute.findUnique({
      where: { id: disputeId },
      include: {
        job: {
          include: {
            customer: { include: { user: true } },
            wonByContractor: { include: { user: true } },
            service: true,
            jobAccess: {
              include: {
                contractor: { include: { user: true } },
              },
            },
          },
        },
        responses: {
          orderBy: { createdAt: 'asc' },
        },
      },
    });

    return dispute;
  },

  /**
   * Get disputes for a user (customer or contractor)
   * Includes disputes they raised AND disputes filed against them
   */
  async getDisputesForUser(userId: string) {
    // Get user's customer/contractor profile
    const user = await prisma.user.findUnique({
      where: { id: userId },
      include: {
        customer: true,
        contractor: true,
      },
    });

    if (!user) {
      return [];
    }

    // Build where clause to include:
    // 1. Disputes raised by this user
    // 2. Disputes where user is the other party (customer or contractor on the job)
    const whereClause: any = {
      OR: [
        { raisedByUserId: userId },
      ],
    };

    // If user is a customer, include disputes on their jobs
    if (user.customer) {
      whereClause.OR.push({
        job: {
          customerId: user.customer.id,
        },
      });
    }

    // If user is a contractor, include disputes on jobs they won
    if (user.contractor) {
      whereClause.OR.push({
        job: {
          wonByContractorId: user.contractor.id,
        },
      });
    }

    return await prisma.dispute.findMany({
      where: whereClause,
      include: {
        job: {
          include: {
            customer: { include: { user: true } },
            wonByContractor: { include: { user: true } },
            service: true,
          },
        },
        responses: {
          where: { isInternal: false },
          orderBy: { createdAt: 'desc' },
          take: 1,
        },
      },
      orderBy: { createdAt: 'desc' },
    });
  },

  /**
   * Notify admins when a dispute is created
   */
  async notifyDisputeCreated(dispute: any) {
    // Note: Admin notifications are not sent through the user notification system
    // as admins have separate accounts. Admins can view disputes in their dashboard.
    
    // Log dispute creation for admin dashboard
    console.log(`New dispute created: ${dispute.id} - ${dispute.title}`);

    // Notify the other party (customer or contractor)
    const job = dispute.job;
    const notifyUserId = dispute.raisedByRole === 'CUSTOMER' 
      ? job.wonByContractor?.userId 
      : job.customer.userId;

    if (notifyUserId) {
      try {
        await createNotification({
          userId: notifyUserId,
          title: 'Dispute Created',
          message: `A dispute has been created for job: ${job.title}`,
          type: 'WARNING',
          actionLink: `/disputes/${dispute.id}`,
          actionText: 'View Dispute',
        });
      } catch (error) {
        console.error(`Failed to notify user ${notifyUserId}:`, error);
      }
    }
  },

  /**
   * Notify parties when a new response is added
   */
  async notifyNewResponse(disputeId: string, responderId: string) {
    const dispute = await this.getDisputeDetails(disputeId);
    if (!dispute) return;

    const job = dispute.job;
    const notifyUserIds: string[] = [];

    // Notify customer
    if (job.customer.userId !== responderId) {
      notifyUserIds.push(job.customer.userId);
    }

    // Notify contractor
    if (job.wonByContractor && job.wonByContractor.userId !== responderId) {
      notifyUserIds.push(job.wonByContractor.userId);
    }

    for (const userId of notifyUserIds) {
      await createNotification({
        userId,
        title: 'New Dispute Response',
        message: `A new response has been added to dispute: ${dispute.title}`,
        type: 'INFO',
        actionLink: `/disputes/${dispute.id}`,
        actionText: 'View Response',
      });
    }
  },

  /**
   * Notify parties when dispute is resolved
   */
  async notifyDisputeResolved(disputeId: string) {
    const dispute = await this.getDisputeDetails(disputeId);
    if (!dispute) return;

    const job = dispute.job;
    const notifyUserIds: string[] = [job.customer.userId];

    if (job.wonByContractor) {
      notifyUserIds.push(job.wonByContractor.userId);
    }

    for (const userId of notifyUserIds) {
      await createNotification({
        userId,
        title: 'Dispute Resolved',
        message: `The dispute "${dispute.title}" has been resolved.`,
        type: 'SUCCESS',
        actionLink: `/disputes/${dispute.id}`,
        actionText: 'View Resolution',
      });
    }
  },

  /**
   * Get dispute statistics
   */
  async getDisputeStats() {
    const [
      totalDisputes,
      openDisputes,
      resolvedDisputes,
      byType,
    ] = await Promise.all([
      prisma.dispute.count(),
      prisma.dispute.count({ where: { status: DisputeStatus.OPEN } }),
      prisma.dispute.count({ where: { status: DisputeStatus.RESOLVED } }),
      prisma.dispute.groupBy({
        by: ['type'],
        _count: true,
      }),
    ]);

    return {
      totalDisputes,
      openDisputes,
      resolvedDisputes,
      byType,
    };
  },
};

