import express, { Request, Response, NextFunction } from 'express';
import { catchAsync } from '../middleware/errorHandler';
import { protectAdmin, requirePermission, AdminAuthRequest } from '../middleware/adminAuth';
import { AdminPermission } from '../config/permissions';
import { prisma } from '../config/database';
import { logActivity } from '../services/auditService';
import { getClientIp, getClientUserAgent } from '../middleware/adminAuth';

const router = express.Router();

// ============================================
// PUBLIC ROUTES (No authentication required)
// ============================================

/**
 * @route   GET /api/faq
 * @desc    Get all active FAQs (public)
 * @access  Public
 */
router.get(
  '/',
  catchAsync(async (req: Request, res: Response) => {
    const { category } = req.query;

    const faqs = await prisma.faq.findMany({
      where: {
        isActive: true,
        ...(category && category !== 'all' ? { category: category as string } : {}),
      },
      orderBy: {
        sortOrder: 'asc',
      },
      select: {
        id: true,
        question: true,
        answer: true,
        category: true,
        sortOrder: true,
      },
    });

    res.status(200).json({
      status: 'success',
      data: {
        faqs,
      },
    });
  })
);

/**
 * @route   GET /api/faq/categories
 * @desc    Get all FAQ categories (public)
 * @access  Public
 */
router.get(
  '/categories',
  catchAsync(async (req: Request, res: Response) => {
    const categories = await prisma.faq.findMany({
      where: {
        isActive: true,
        category: {
          not: null,
        },
      },
      select: {
        category: true,
      },
      distinct: ['category'],
    });

    const categoryList = categories
      .map((c) => c.category)
      .filter((c): c is string => c !== null)
      .sort();

    res.status(200).json({
      status: 'success',
      data: {
        categories: categoryList,
      },
    });
  })
);

// ============================================
// ADMIN ROUTES (Authentication required)
// ============================================

/**
 * @route   GET /api/faq/admin
 * @desc    Get all FAQs for admin management (including inactive)
 * @access  Admin
 */
router.get(
  '/admin',
  protectAdmin,
  requirePermission(AdminPermission.SETTINGS_READ),
  catchAsync(async (req: AdminAuthRequest, res: Response) => {
    const { category, status } = req.query;

    const faqs = await prisma.faq.findMany({
      where: {
        ...(category && category !== 'all' ? { category: category as string } : {}),
        ...(status === 'active' ? { isActive: true } : {}),
        ...(status === 'inactive' ? { isActive: false } : {}),
      },
      orderBy: {
        sortOrder: 'asc',
      },
    });

    res.status(200).json({
      status: 'success',
      data: {
        faqs,
      },
    });
  })
);

/**
 * @route   POST /api/faq
 * @desc    Create a new FAQ
 * @access  Admin
 */
router.post(
  '/',
  protectAdmin,
  requirePermission(AdminPermission.SETTINGS_WRITE),
  catchAsync(async (req: AdminAuthRequest, res: Response) => {
    const { question, answer, category, sortOrder, isActive } = req.body;

    if (!question || !answer) {
      return res.status(400).json({
        status: 'error',
        message: 'Question and answer are required',
      });
    }

    // Get the highest sort order and add 1
    const highestOrder = await prisma.faq.findFirst({
      orderBy: {
        sortOrder: 'desc',
      },
      select: {
        sortOrder: true,
      },
    });

    const newSortOrder = sortOrder !== undefined ? sortOrder : (highestOrder?.sortOrder || 0) + 1;

    const faq = await prisma.faq.create({
      data: {
        question,
        answer,
        category: category || 'General',
        sortOrder: newSortOrder,
        isActive: isActive !== undefined ? isActive : true,
      },
    });

    await logActivity({
      adminId: req.admin!.id,
      action: 'FAQ_CREATE',
      entityType: 'Faq',
      entityId: faq.id,
      description: `Created FAQ: ${question}`,
      ipAddress: getClientIp(req),
      userAgent: getClientUserAgent(req),
    });

    res.status(201).json({
      status: 'success',
      data: {
        faq,
      },
    });
  })
);

/**
 * @route   PATCH /api/faq/:id
 * @desc    Update an existing FAQ
 * @access  Admin
 */
router.patch(
  '/:id',
  protectAdmin,
  requirePermission(AdminPermission.SETTINGS_WRITE),
  catchAsync(async (req: AdminAuthRequest, res: Response) => {
    const { id } = req.params;
    const { question, answer, category, sortOrder, isActive } = req.body;

    const existingFaq = await prisma.faq.findUnique({
      where: { id },
    });

    if (!existingFaq) {
      return res.status(404).json({
        status: 'error',
        message: 'FAQ not found',
      });
    }

    const faq = await prisma.faq.update({
      where: { id },
      data: {
        ...(question !== undefined && { question }),
        ...(answer !== undefined && { answer }),
        ...(category !== undefined && { category }),
        ...(sortOrder !== undefined && { sortOrder }),
        ...(isActive !== undefined && { isActive }),
      },
    });

    await logActivity({
      adminId: req.admin!.id,
      action: 'FAQ_UPDATE',
      entityType: 'Faq',
      entityId: faq.id,
      description: `Updated FAQ: ${faq.question}`,
      diff: {
        before: existingFaq,
        after: faq,
      },
      ipAddress: getClientIp(req),
      userAgent: getClientUserAgent(req),
    });

    res.status(200).json({
      status: 'success',
      data: {
        faq,
      },
    });
  })
);

/**
 * @route   DELETE /api/faq/:id
 * @desc    Delete an FAQ
 * @access  Admin
 */
router.delete(
  '/:id',
  protectAdmin,
  requirePermission(AdminPermission.SETTINGS_WRITE),
  catchAsync(async (req: AdminAuthRequest, res: Response) => {
    const { id } = req.params;

    const faq = await prisma.faq.findUnique({
      where: { id },
    });

    if (!faq) {
      return res.status(404).json({
        status: 'error',
        message: 'FAQ not found',
      });
    }

    await prisma.faq.delete({
      where: { id },
    });

    await logActivity({
      adminId: req.admin!.id,
      action: 'FAQ_DELETE',
      entityType: 'Faq',
      entityId: id,
      description: `Deleted FAQ: ${faq.question}`,
      ipAddress: getClientIp(req),
      userAgent: getClientUserAgent(req),
    });

    res.status(200).json({
      status: 'success',
      message: 'FAQ deleted successfully',
    });
  })
);

/**
 * @route   PATCH /api/faq/:id/toggle
 * @desc    Toggle FAQ active status
 * @access  Admin
 */
router.patch(
  '/:id/toggle',
  protectAdmin,
  requirePermission(AdminPermission.SETTINGS_WRITE),
  catchAsync(async (req: AdminAuthRequest, res: Response) => {
    const { id } = req.params;

    const existingFaq = await prisma.faq.findUnique({
      where: { id },
    });

    if (!existingFaq) {
      return res.status(404).json({
        status: 'error',
        message: 'FAQ not found',
      });
    }

    const faq = await prisma.faq.update({
      where: { id },
      data: {
        isActive: !existingFaq.isActive,
      },
    });

    await logActivity({
      adminId: req.admin!.id,
      action: 'FAQ_UPDATE',
      entityType: 'Faq',
      entityId: faq.id,
      description: `${faq.isActive ? 'Activated' : 'Deactivated'} FAQ: ${faq.question}`,
      ipAddress: getClientIp(req),
      userAgent: getClientUserAgent(req),
    });

    res.status(200).json({
      status: 'success',
      data: {
        faq,
      },
    });
  })
);

/**
 * @route   POST /api/faq/:id/reorder
 * @desc    Reorder FAQs (move up/down)
 * @access  Admin
 */
router.post(
  '/:id/reorder',
  protectAdmin,
  requirePermission(AdminPermission.SETTINGS_WRITE),
  catchAsync(async (req: AdminAuthRequest, res: Response) => {
    const { id } = req.params;
    const { direction } = req.body; // 'up' or 'down'

    const currentFaq = await prisma.faq.findUnique({
      where: { id },
    });

    if (!currentFaq) {
      return res.status(404).json({
        status: 'error',
        message: 'FAQ not found',
      });
    }

    if (direction === 'up') {
      // Find the FAQ with the next lower sortOrder
      const previousFaq = await prisma.faq.findFirst({
        where: {
          sortOrder: {
            lt: currentFaq.sortOrder,
          },
        },
        orderBy: {
          sortOrder: 'desc',
        },
      });

      if (previousFaq) {
        // Swap sort orders
        await prisma.$transaction([
          prisma.faq.update({
            where: { id: currentFaq.id },
            data: { sortOrder: previousFaq.sortOrder },
          }),
          prisma.faq.update({
            where: { id: previousFaq.id },
            data: { sortOrder: currentFaq.sortOrder },
          }),
        ]);
      }
    } else if (direction === 'down') {
      // Find the FAQ with the next higher sortOrder
      const nextFaq = await prisma.faq.findFirst({
        where: {
          sortOrder: {
            gt: currentFaq.sortOrder,
          },
        },
        orderBy: {
          sortOrder: 'asc',
        },
      });

      if (nextFaq) {
        // Swap sort orders
        await prisma.$transaction([
          prisma.faq.update({
            where: { id: currentFaq.id },
            data: { sortOrder: nextFaq.sortOrder },
          }),
          prisma.faq.update({
            where: { id: nextFaq.id },
            data: { sortOrder: currentFaq.sortOrder },
          }),
        ]);
      }
    }

    await logActivity({
      adminId: req.admin!.id,
      action: 'FAQ_UPDATE',
      entityType: 'Faq',
      entityId: id,
      description: `Reordered FAQ: ${currentFaq.question} (${direction})`,
      ipAddress: getClientIp(req),
      userAgent: getClientUserAgent(req),
    });

    res.status(200).json({
      status: 'success',
      message: 'FAQ reordered successfully',
    });
  })
);

export default router;

