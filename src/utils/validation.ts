/**
 * Request Validation Utility
 * 
 * Provides consistent request validation across all controllers using Zod.
 * Use this middleware to validate request body, query params, and params.
 * 
 * Usage:
 * ```typescript
 * import { validateRequest } from '../utils/validation';
 * import { z } from 'zod';
 * 
 * const schema = z.object({
 *   email: z.string().email(),
 *   password: z.string().min(8)
 * });
 * 
 * router.post('/endpoint', validateRequest(schema), controller.handler);
 * ```
 */

import { Request, Response, NextFunction } from 'express';
import { z, ZodError, ZodSchema } from 'zod';
import logger from './logger';

/**
 * Validation middleware factory
 * @param schema Zod schema to validate against
 * @param source Which part of the request to validate (body, query, params)
 */
export const validateRequest = (
  schema: ZodSchema,
  source: 'body' | 'query' | 'params' = 'body'
) => {
  return (req: Request, res: Response, next: NextFunction): void => {
    try {
      const data = req[source];
      const validated = schema.parse(data);
      
      // Replace request data with validated and typed data
      (req as any)[source] = validated;
      
      next();
    } catch (error) {
      if (error instanceof ZodError) {
        const errorMessages = error.issues.map((err) => ({
          field: err.path.join('.'),
          message: err.message,
          code: err.code
        }));
        
        logger.warn('Request validation failed', {
          path: req.path,
          method: req.method,
          errors: errorMessages
        });
        
        res.status(400).json({
          message: 'Validation error',
          errors: errorMessages
        });
        return;
      }
      
      next(error);
    }
  };
};

/**
 * Common validation schemas for reuse across controllers
 */
export const commonSchemas = {
  // Pagination
  pagination: z.object({
    page: z.string().optional().transform(val => val ? parseInt(val, 10) : 1),
    limit: z.string().optional().transform(val => val ? parseInt(val, 10) : 10),
  }),
  
  // Health ID
  healthId: z.string().regex(/^HID-\d{4}-[A-F0-9]{8}$/, 'Invalid Health ID format'),
  
  // UUID
  uuid: z.string().uuid(),
  
  // Date range
  dateRange: z.object({
    startDate: z.string().datetime().optional(),
    endDate: z.string().datetime().optional(),
  }),
  
  // Email
  email: z.string().email().toLowerCase(),
  
  // Phone (international format)
  phone: z.string().regex(/^\+[1-9]\d{1,14}$/, 'Invalid phone number format'),
  
  // Password (production-grade requirements)
  password: z.string()
    .min(8, 'Password must be at least 8 characters')
    .regex(/[A-Z]/, 'Password must contain at least one uppercase letter')
    .regex(/[a-z]/, 'Password must contain at least one lowercase letter')
    .regex(/[0-9]/, 'Password must contain at least one number'),
};

/**
 * Validation error formatter for consistent error responses
 */
export const formatValidationError = (error: ZodError) => {
  return {
    message: 'Validation failed',
    errors: error.issues.map((err) => ({
      field: err.path.join('.'),
      message: err.message,
      code: err.code,
      expected: (err as any).expected,
      received: (err as any).received
    }))
  };
};

export default {
  validateRequest,
  commonSchemas,
  formatValidationError
};
