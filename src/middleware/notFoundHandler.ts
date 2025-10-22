import { Request, Response, NextFunction } from 'express';
import { AppError } from './errorHandler';

export const notFoundHandler = (req: Request, res: Response, next: NextFunction): void => {
  const err = new AppError(`Can't find ${req.originalUrl} on this server!`, 404);
  next(err);
}; 
