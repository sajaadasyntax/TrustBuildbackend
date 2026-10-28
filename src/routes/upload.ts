import { Router, Request, Response, NextFunction } from 'express';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import { catchAsync, AppError } from '../middleware/errorHandler';
import { protect } from '../middleware/auth';
import { uploadBufferToCloudinary, uploadConfigs } from '../config/cloudinary';
import { buildLocalUploadUrl, isCloudinaryUploadEnabled } from '../utils/uploadStorage';

const router = Router();

const MAX_FILE_SIZE_BYTES = 15 * 1024 * 1024;
const ALLOWED_IMAGE_TYPES = [
  'image/jpeg',
  'image/jpg',
  'image/png',
  'image/webp',
  'image/gif',
  // HEIC/HEIF are excluded: browsers cannot resize them and the frontend
  // already blocks them with a clear error message, so reject them here too.
];

const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: MAX_FILE_SIZE_BYTES,
  },
  fileFilter: (req, file, cb) => {
    const ext = path.extname(file.originalname || '').toLowerCase();
    const allowedExt = ['.jpg', '.jpeg', '.png', '.webp', '.gif'];
    const mimeOk = ALLOWED_IMAGE_TYPES.includes(file.mimetype) || file.mimetype.startsWith('image/');
    const extOk = allowedExt.includes(ext);

    if (mimeOk || extOk) {
      cb(null, true);
      return;
    }

    cb(new AppError('Unsupported file format. Please upload a JPG, PNG, or WEBP image (max 15MB).', 400));
  },
});

const persistUploadedImage = async (file: Express.Multer.File, req: Request) => {
  if (isCloudinaryUploadEnabled()) {
    let result;
    try {
      result = await uploadBufferToCloudinary(file.buffer, {
        folder: uploadConfigs.portfolioImage.folder,
        resource_type: 'image',
        quality: 'auto:good',
        format: 'jpg',
      });
    } catch (error) {
      console.error('Portfolio image Cloudinary upload failed:', error);
      throw new AppError(
        'Could not process this image. Please upload a JPG or PNG under 15MB (HEIC/iPhone photos: export as JPEG first).',
        400
      );
    }

    return {
      url: result.secure_url || result.url,
      filename: result.public_id,
      originalName: file.originalname,
      size: result.bytes || file.size,
      mimetype: file.mimetype,
      cloudinaryId: result.public_id,
    };
  }

  const uploadDir = path.join(process.cwd(), 'uploads');
  if (!fs.existsSync(uploadDir)) {
    fs.mkdirSync(uploadDir, { recursive: true });
  }

  const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1e9);
  const ext = path.extname(file.originalname) || '.jpg';
  const filename = `${file.fieldname}-${uniqueSuffix}${ext}`;
  const filePath = path.join(uploadDir, filename);
  fs.writeFileSync(filePath, file.buffer);

  const fileUrl = buildLocalUploadUrl(req, filename);

  return {
    url: fileUrl,
    filename,
    originalName: file.originalname,
    size: file.size,
    mimetype: file.mimetype,
  };
};

const handleUploadMiddleware = (req: Request, res: Response, next: NextFunction) => {
  upload.single('file')(req, res, (err: any) => {
    if (err) {
      return next(err);
    }
    next();
  });
};

const handleMultipleUploadMiddleware = (req: Request, res: Response, next: NextFunction) => {
  upload.array('files', 10)(req, res, (err: any) => {
    if (err) {
      return next(err);
    }
    next();
  });
};

router.post('/', protect, handleUploadMiddleware, catchAsync(async (req: any, res: any) => {
  if (!req.file) {
    return res.status(400).json({
      status: 'error',
      message: 'No file uploaded. Please choose a JPG, PNG, or WEBP image up to 15MB.',
    });
  }

  const data = await persistUploadedImage(req.file, req);

  res.status(200).json({
    status: 'success',
    data,
  });
}));

router.post('/multiple', protect, handleMultipleUploadMiddleware, catchAsync(async (req: any, res: any) => {
  if (!req.files || req.files.length === 0) {
    return res.status(400).json({
      status: 'error',
      message: 'No files uploaded. Please choose JPG, PNG, or WEBP images up to 15MB each.',
    });
  }

  const files = [];
  for (const file of req.files) {
    files.push(await persistUploadedImage(file, req));
  }

  res.status(200).json({
    status: 'success',
    data: {
      files,
      urls: files.map((file: any) => file.url),
      cloudinaryIds: files.map((file: any) => file.cloudinaryId).filter(Boolean),
    },
  });
}));

router.delete('/:filename', protect, catchAsync(async (req: any, res: any) => {
  const filename = req.params.filename;
  const filePath = path.join(process.cwd(), 'uploads', filename);

  if (fs.existsSync(filePath)) {
    fs.unlinkSync(filePath);
    res.status(200).json({
      status: 'success',
      message: 'File deleted successfully',
    });
  } else {
    res.status(404).json({
      status: 'error',
      message: 'File not found',
    });
  }
}));

export default router;
