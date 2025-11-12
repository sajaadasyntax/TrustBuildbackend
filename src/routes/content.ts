import express, { Request, Response } from 'express';
import { catchAsync } from '../middleware/errorHandler';
import {
  protectAdmin,
  requirePermission,
  getClientIp,
  getClientUserAgent,
  AdminAuthRequest,
} from '../middleware/adminAuth';
import { AdminPermission } from '../config/permissions';
import { logActivity } from '../services/auditService';
import { prisma } from '../config/database';

const router = express.Router();

// Default platform content
const DEFAULT_CONTENT = {
  hero: {
    title: "Find Trusted Contractors For Your Next Project",
    subtitle: "TrustBuild connects you with verified professionals for all your construction and renovation needs.",
    ctaText: "Post a Job",
    ctaSecondaryText: "Join as a Contractor"
  },
  features: [
    {
      title: "Verified Contractors",
      description: "All contractors are thoroughly vetted and verified for your peace of mind.",
      icon: "shield",
    },
    {
      title: "Quality Guarantee",
      description: "We guarantee the quality of work and provide dispute resolution.",
      icon: "star",
    },
    {
      title: "Transparent Pricing",
      description: "Get clear, upfront pricing with no hidden fees or surprises.",
      icon: "dollar",
    },
  ],
  howItWorks: [
    {
      step: 1,
      title: "Post Your Project",
      description: "Describe your project, budget, and timeline, and we'll match you with the right professionals.",
      icon: "building"
    },
    {
      step: 2,
      title: "Compare Contractors",
      description: "Review profiles, ratings, and previous work to find the perfect match for your needs.",
      icon: "wrench"
    },
    {
      step: 3,
      title: "Get It Done",
      description: "Hire your chosen contractor and track progress every step of the way.",
      icon: "checkCircle"
    }
  ],
  testimonials: [
    {
      name: "Sarah Johnson",
      comment: "TrustBuild helped me find an amazing contractor for my kitchen renovation. The process was smooth and professional.",
      rating: 5,
      project: "Kitchen Renovation",
    },
    {
      name: "Mike Davis",
      comment: "Excellent service! The contractor was reliable and delivered exactly what was promised.",
      rating: 5,
      project: "Bathroom Remodeling",
    },
  ],
  about: {
    mission: "To connect homeowners with trusted, verified contractors for seamless home improvement projects.",
    vision: "Building trust in the home improvement industry through transparency and quality assurance.",
    values: "Integrity, Quality, Transparency, Customer Satisfaction",
  },
  stats: {
    projectsCompleted: "1000+",
    verifiedContractors: "500+",
    customerSatisfaction: "98%",
    averageRating: "4.8"
  }
};

// @desc    Get platform content (public route)
// @route   GET /api/content/platform
// @access  Public
router.get(
  '/platform',
  catchAsync(async (req: Request, res: Response) => {
    const setting = await prisma.adminSettings.findUnique({
      where: { key: 'PLATFORM_CONTENT' },
    });

    let content = DEFAULT_CONTENT;

    if (setting?.value) {
      try {
        content = JSON.parse(setting.value);
      } catch (error) {
        console.error('Failed to parse platform content:', error);
        // Use default if parsing fails
      }
    }

    res.status(200).json({
      status: 'success',
      data: { content },
    });
  })
);

// @desc    Get specific content section (public route)
// @route   GET /api/content/platform/:section
// @access  Public
router.get(
  '/platform/:section',
  catchAsync(async (req: Request, res: Response) => {
    const { section } = req.params;

    const setting = await prisma.adminSettings.findUnique({
      where: { key: 'PLATFORM_CONTENT' },
    });

    let content = DEFAULT_CONTENT;

    if (setting?.value) {
      try {
        content = JSON.parse(setting.value);
      } catch (error) {
        console.error('Failed to parse platform content:', error);
      }
    }

    const sectionContent = content[section as keyof typeof content];

    if (!sectionContent) {
      return res.status(404).json({
        status: 'error',
        message: 'Content section not found',
      });
    }

    res.status(200).json({
      status: 'success',
      data: { [section]: sectionContent },
    });
  })
);

// @desc    Update platform content (admin only)
// @route   PATCH /api/content/platform
// @access  Private/Admin
router.patch(
  '/platform',
  protectAdmin,
  requirePermission(AdminPermission.CONTENT_WRITE),
  catchAsync(async (req: AdminAuthRequest, res: Response) => {
    const { content } = req.body;

    if (!content || typeof content !== 'object') {
      return res.status(400).json({
        status: 'error',
        message: 'Invalid content format',
      });
    }

    // Get old content for audit log
    const oldSetting = await prisma.adminSettings.findUnique({
      where: { key: 'PLATFORM_CONTENT' },
    });

    const contentString = JSON.stringify(content);

    const setting = await prisma.adminSettings.upsert({
      where: { key: 'PLATFORM_CONTENT' },
      update: {
        value: contentString,
        description: 'Platform homepage and content settings',
      },
      create: {
        key: 'PLATFORM_CONTENT',
        value: contentString,
        description: 'Platform homepage and content settings',
      },
    });

    await logActivity({
      adminId: req.admin!.id,
      action: 'CONTENT_UPDATE',
      entityType: 'AdminSettings',
      entityId: setting.id,
      description: 'Updated platform content',
      diff: {
        before: oldSetting?.value ? JSON.parse(oldSetting.value) : DEFAULT_CONTENT,
        after: content,
      },
      ipAddress: getClientIp(req),
      userAgent: getClientUserAgent(req),
    });

    res.status(200).json({
      status: 'success',
      data: { content },
      message: 'Platform content updated successfully',
    });
  })
);

// @desc    Update specific content section (admin only)
// @route   PATCH /api/content/platform/:section
// @access  Private/Admin
router.patch(
  '/platform/:section',
  protectAdmin,
  requirePermission(AdminPermission.CONTENT_WRITE),
  catchAsync(async (req: AdminAuthRequest, res: Response) => {
    const { section } = req.params;
    const { data } = req.body;

    if (!data) {
      return res.status(400).json({
        status: 'error',
        message: 'Data is required',
      });
    }

    // Get current content
    const setting = await prisma.adminSettings.findUnique({
      where: { key: 'PLATFORM_CONTENT' },
    });

    let currentContent = DEFAULT_CONTENT;

    if (setting?.value) {
      try {
        currentContent = JSON.parse(setting.value);
      } catch (error) {
        console.error('Failed to parse platform content:', error);
      }
    }

    // Update specific section
    const updatedContent = {
      ...currentContent,
      [section]: data,
    };

    const contentString = JSON.stringify(updatedContent);

    const updatedSetting = await prisma.adminSettings.upsert({
      where: { key: 'PLATFORM_CONTENT' },
      update: {
        value: contentString,
        description: 'Platform homepage and content settings',
      },
      create: {
        key: 'PLATFORM_CONTENT',
        value: contentString,
        description: 'Platform homepage and content settings',
      },
    });

    await logActivity({
      adminId: req.admin!.id,
      action: 'CONTENT_UPDATE',
      entityType: 'AdminSettings',
      entityId: updatedSetting.id,
      description: `Updated platform content section: ${section}`,
      diff: {
        before: currentContent[section as keyof typeof currentContent],
        after: data,
      },
      ipAddress: getClientIp(req),
      userAgent: getClientUserAgent(req),
    });

    res.status(200).json({
      status: 'success',
      data: { [section]: data },
      message: `Content section '${section}' updated successfully`,
    });
  })
);

// @desc    Reset platform content to defaults (admin only)
// @route   POST /api/content/platform/reset
// @access  Private/Admin
router.post(
  '/platform/reset',
  protectAdmin,
  requirePermission(AdminPermission.CONTENT_WRITE),
  catchAsync(async (req: AdminAuthRequest, res: Response) => {
    const contentString = JSON.stringify(DEFAULT_CONTENT);

    const setting = await prisma.adminSettings.upsert({
      where: { key: 'PLATFORM_CONTENT' },
      update: {
        value: contentString,
        description: 'Platform homepage and content settings',
      },
      create: {
        key: 'PLATFORM_CONTENT',
        value: contentString,
        description: 'Platform homepage and content settings',
      },
    });

    await logActivity({
      adminId: req.admin!.id,
      action: 'CONTENT_RESET',
      entityType: 'AdminSettings',
      entityId: setting.id,
      description: 'Reset platform content to defaults',
      ipAddress: getClientIp(req),
      userAgent: getClientUserAgent(req),
    });

    res.status(200).json({
      status: 'success',
      data: { content: DEFAULT_CONTENT },
      message: 'Platform content reset to defaults successfully',
    });
  })
);

export default router;

