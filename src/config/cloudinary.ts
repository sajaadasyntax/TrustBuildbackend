import { v2 as cloudinary } from 'cloudinary';
import dotenv from 'dotenv';

dotenv.config();

// Configure Cloudinary
cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
});

// Verify configuration
if (!process.env.CLOUDINARY_CLOUD_NAME || !process.env.CLOUDINARY_API_KEY || !process.env.CLOUDINARY_API_SECRET) {
  console.warn('⚠️  Cloudinary configuration is incomplete. File uploads may not work properly.');
} else {

}

export interface UploadOptions {
  folder?: string;
  public_id?: string;
  overwrite?: boolean;
  resource_type?: 'image' | 'video' | 'raw' | 'auto';
  format?: string;
  width?: number;
  height?: number;
  crop?: string;
  quality?: string | number;
}

export interface UploadResult {
  public_id: string;
  secure_url: string;
  url: string;
  format: string;
  resource_type: string;
  bytes: number;
  width?: number;
  height?: number;
  folder?: string;
  created_at: string;
}

/**
 * Upload a file to Cloudinary
 */
export const uploadToCloudinary = async (
  filePath: string,
  options: UploadOptions = {}
): Promise<UploadResult> => {
  try {
    const result = await cloudinary.uploader.upload(filePath, {
      folder: options.folder || 'trustbuild',
      public_id: options.public_id,
      overwrite: options.overwrite ?? true,
      resource_type: options.resource_type || 'auto',
      format: options.format,
      transformation: options.width || options.height ? [
        {
          width: options.width,
          height: options.height,
          crop: options.crop || 'fill',
          quality: options.quality || 'auto',
        },
      ] : undefined,
    });

    return result as UploadResult;
  } catch (error) {
    console.error('Cloudinary upload error:', error);
    throw new Error('Failed to upload file to Cloudinary');
  }
};

/**
 * Upload a buffer to Cloudinary
 */
export const uploadBufferToCloudinary = async (
  buffer: Buffer,
  options: UploadOptions = {}
): Promise<UploadResult> => {
  try {
    return new Promise((resolve, reject) => {
      cloudinary.uploader.upload_stream(
        {
          folder: options.folder || 'trustbuild',
          public_id: options.public_id,
          overwrite: options.overwrite ?? true,
          resource_type: options.resource_type || 'auto',
          format: options.format,
          transformation: options.width || options.height ? [
            {
              width: options.width,
              height: options.height,
              crop: options.crop || 'fill',
              quality: options.quality || 'auto',
            },
          ] : undefined,
        },
        (error, result) => {
          if (error) {
            console.error('Cloudinary buffer upload error:', error);
            reject(new Error('Failed to upload buffer to Cloudinary'));
          } else {
            resolve(result as UploadResult);
          }
        }
      ).end(buffer);
    });
  } catch (error) {
    console.error('Cloudinary buffer upload error:', error);
    throw new Error('Failed to upload buffer to Cloudinary');
  }
};

/**
 * Delete a file from Cloudinary
 */
export const deleteFromCloudinary = async (publicId: string): Promise<void> => {
  try {
    await cloudinary.uploader.destroy(publicId);
  } catch (error) {
    console.error('Cloudinary delete error:', error);
    throw new Error('Failed to delete file from Cloudinary');
  }
};

/**
 * Get optimized image URL
 */
export const getOptimizedImageUrl = (
  publicId: string,
  options: {
    width?: number;
    height?: number;
    quality?: string | number;
    format?: string;
    crop?: string;
  } = {}
): string => {
  return cloudinary.url(publicId, {
    width: options.width,
    height: options.height,
    quality: options.quality || 'auto',
    format: options.format || 'auto',
    crop: options.crop || 'fill',
    fetch_format: 'auto',
  });
};

/**
 * Predefined upload configurations
 */
export const uploadConfigs = {
  profileImage: {
    folder: 'trustbuild/profiles',
    width: 400,
    height: 400,
    crop: 'fill',
    quality: 80,
    format: 'jpg',
  },
  portfolioImage: {
    folder: 'trustbuild/portfolio',
    width: 800,
    height: 600,
    crop: 'fill',
    quality: 85,
    format: 'jpg',
  },
  document: {
    folder: 'trustbuild/documents',
    resource_type: 'auto' as const,
  },
  workPhoto: {
    folder: 'trustbuild/work-photos',
    width: 800,
    height: 600,
    crop: 'fill',
    quality: 85,
    format: 'jpg',
  },
};

export default cloudinary; 
