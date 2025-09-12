import { Router } from 'express';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import { catchAsync, AppError } from '../middleware/errorHandler';
import { protect } from '../middleware/auth';

const router = Router();

// Configure multer for file uploads
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const uploadDir = path.join(__dirname, '../../uploads');
    if (!fs.existsSync(uploadDir)) {
      fs.mkdirSync(uploadDir, { recursive: true });
    }
    cb(null, uploadDir);
  },
  filename: (req, file, cb) => {
    // Generate unique filename
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    const ext = path.extname(file.originalname);
    cb(null, file.fieldname + '-' + uniqueSuffix + ext);
  }
});

const upload = multer({
  storage: storage,
  limits: {
    fileSize: 5 * 1024 * 1024, // 5MB limit
  },
  fileFilter: (req, file, cb) => {
    // Check file type
    if (file.mimetype.startsWith('image/')) {
      cb(null, true);
    } else {
      cb(new AppError('Only image files are allowed', 400));
    }
  }
});

// Upload single file
router.post('/', protect, upload.single('file'), catchAsync(async (req: any, res: any) => {
  if (!req.file) {
    return res.status(400).json({
      status: 'error',
      message: 'No file uploaded'
    });
  }

  // Generate URL for the uploaded file
  const fileUrl = `${req.protocol}://${req.get('host')}/uploads/${req.file.filename}`;

  res.status(200).json({
    status: 'success',
    data: {
      url: fileUrl,
      filename: req.file.filename,
      originalName: req.file.originalname,
      size: req.file.size,
      mimetype: req.file.mimetype
    }
  });
}));

// Upload multiple files
router.post('/multiple', protect, upload.array('files', 10), catchAsync(async (req: any, res: any) => {
  if (!req.files || req.files.length === 0) {
    return res.status(400).json({
      status: 'error',
      message: 'No files uploaded'
    });
  }

  const files = req.files.map((file: any) => ({
    url: `${req.protocol}://${req.get('host')}/uploads/${file.filename}`,
    filename: file.filename,
    originalName: file.originalname,
    size: file.size,
    mimetype: file.mimetype
  }));

  res.status(200).json({
    status: 'success',
    data: {
      files: files,
      urls: files.map((file: any) => file.url)
    }
  });
}));

// Delete file
router.delete('/:filename', protect, catchAsync(async (req: any, res: any) => {
  const filename = req.params.filename;
  const filePath = path.join(__dirname, '../../uploads', filename);

  if (fs.existsSync(filePath)) {
    fs.unlinkSync(filePath);
    res.status(200).json({
      status: 'success',
      message: 'File deleted successfully'
    });
  } else {
    res.status(404).json({
      status: 'error',
      message: 'File not found'
    });
  }
}));

export default router; 