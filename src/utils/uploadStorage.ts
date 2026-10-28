import type { Request } from 'express';

/** Cloudinary is opt-in only — local disk is the default storage. */
export function isCloudinaryUploadEnabled(): boolean {
  if (process.env.CLOUDINARY_ENABLED !== 'true') {
    return false;
  }
  return !!(
    process.env.CLOUDINARY_CLOUD_NAME &&
    process.env.CLOUDINARY_API_KEY &&
    process.env.CLOUDINARY_API_SECRET
  );
}

/** Base URL for publicly served files (no trailing slash). */
export function getPublicUploadBaseUrl(req: Request): string {
  const fromEnv = process.env.API_PUBLIC_URL || process.env.API_URL;
  if (fromEnv) {
    return fromEnv.replace(/\/$/, '').replace(/\/api$/, '');
  }

  const host = req.get('host');
  const protocol = req.get('x-forwarded-proto') || req.protocol;
  return `${protocol}://${host}`;
}

export function buildLocalUploadUrl(req: Request, filename: string): string {
  return `${getPublicUploadBaseUrl(req)}/api/uploads/${filename}`;
}
