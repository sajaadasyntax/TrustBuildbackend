import { Router } from 'express';

const router = Router();

// Upload routes will be implemented here
router.post('/', (req: any, res: any) => {
  res.json({ message: 'Upload routes' });
});

export default router; 