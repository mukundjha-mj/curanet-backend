/**
 * Prisma Client Singleton
 * 
 * Ensures only one PrismaClient instance is created and reused across the application.
 * This is crucial for:
 * - Connection pooling efficiency
 * - Preventing connection exhaustion
 * - Better performance
 */

import { PrismaClient } from '@prisma/client';

// PrismaClient configuration with connection pooling
const prismaClientSingleton = () => {
  return new PrismaClient({
    log: process.env.NODE_ENV === 'production' 
      ? ['error', 'warn']
      : ['query', 'error', 'warn'],
    
    // Connection pool configuration (optimal for serverless/production)
    datasources: {
      db: {
        url: process.env.DATABASE_URL
      }
    }
  });
};

// Global singleton to prevent multiple instances in development (hot reload)
declare global {
  var prisma: undefined | ReturnType<typeof prismaClientSingleton>;
}

const prisma = globalThis.prisma ?? prismaClientSingleton();

// In development, preserve singleton across hot reloads
if (process.env.NODE_ENV !== 'production') {
  globalThis.prisma = prisma;
}

// Graceful disconnect helper
export const disconnectPrisma = async () => {
  await prisma.$disconnect();
};

// Health check helper
export const checkDatabaseConnection = async (): Promise<boolean> => {
  try {
    await prisma.$queryRaw`SELECT 1`;
    return true;
  } catch (error) {
    return false;
  }
};

export default prisma;
