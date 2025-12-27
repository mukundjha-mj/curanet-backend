import express from 'express';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import dotenv from 'dotenv';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import logger from './utils/logger';
import { requestTracking, initializeAPM } from './utils/apm';

// Load environment variables
dotenv.config();

// Initialize APM (must be early in startup)
initializeAPM();

// Routes
import authRoutes from './routes/auth.routes';
import recordRoutes from './routes/records.routes';
import adminRoutes from './routes/admin.routes';
import healthIdRoutes from './routes/healthId.routes';
import consentRoutes from './routes/consent.routes';
import auditRoutes from './routes/audit.routes';
import emergencyRoutes from './routes/emergency.routes';
import oneRoutes from './routes/one.routes';
import appointmentsRoutes from './routes/appointments.routes';
import notificationsRoutes from './routes/notifications.routes';
import uploadsRoutes from './routes/uploads.routes';
import adminFilesRoutes from './routes/admin-files.routes';
import recordAttachmentsRoutes from './routes/record-attachments.routes';
import publicSettingsRoutes from './routes/public-settings.routes';
import userSettingsRoutes from './routes/user-settings.routes';
import comprehensiveSettingsRoutes from './routes/comprehensive-settings.routes';
import enhancedObservationsRoutes from './routes/enhanced-observations.routes';
import enhancedEncountersRoutes from './routes/enhanced-encounters.routes';
import selfReportingRoutes from './routes/self-reporting.routes';
import analyticsRoutes from './routes/analytics.routes';
import profileRoutes from './routes/profile.routes';

const app = express();

// Security headers with helmet
app.use(helmet({
	contentSecurityPolicy: {
		directives: {
			defaultSrc: ["'self'"],
			styleSrc: ["'self'", "'unsafe-inline'"],
			scriptSrc: ["'self'"],
			imgSrc: ["'self'", "data:", "https:"],
		},
	},
	crossOriginEmbedderPolicy: false, // Allow embedded resources
	hsts: {
		maxAge: 31536000,
		includeSubDomains: true,
		preload: true
	}
}));

// Global rate limiter - 100 requests per 15 minutes per IP
const limiter = rateLimit({
	windowMs: 15 * 60 * 1000, // 15 minutes
	max: 100,
	standardHeaders: true,
	legacyHeaders: false,
	message: 'Too many requests from this IP, please try again later.',
	skip: (req) => process.env.NODE_ENV !== 'production' && req.ip === '::1' // Skip in dev for localhost
});
app.use(limiter);

// Basic middlewares
if (!process.env.CORS_ORIGIN) {
	throw new Error('CORS_ORIGIN environment variable must be set');
}

const allowedOrigins = process.env.CORS_ORIGIN.split(',').map(o => o.trim());

const corsOptions: cors.CorsOptions = {
	origin: (origin, callback) => {
		// Allow requests with no origin (mobile apps, Postman, curl, etc.)
		if (!origin) return callback(null, true);
		
		if (allowedOrigins.includes(origin)) {
			callback(null, true);
		} else {
			// Reject CORS request (don't throw error, just return false)
			logger.warn('CORS request blocked', { origin, allowedOrigins });
			callback(null, false);
		}
	},
	credentials: true,
	methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
	allowedHeaders: ['Content-Type', 'Authorization', 'X-CSRF-Token'],
	optionsSuccessStatus: 204,
};

app.use(cors(corsOptions));
// Handle CORS preflight (OPTIONS) across-the-board using a regex (Express 5 compatible)
app.options(/.*/, cors(corsOptions));
// Handle CORS preflight (OPTIONS) for all API routes (Express 5 doesn't support '*')
app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());

// Request tracking and correlation IDs
app.use(requestTracking);

// Mount routes
app.use('/api/auth', authRoutes);
app.use('/api/records', recordRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/healthid', healthIdRoutes);
app.use('/api/consent', consentRoutes);
app.use('/api/audit', auditRoutes);
app.use('/api/emergency', emergencyRoutes);
app.use('/one', oneRoutes);
app.use('/api/appointments', appointmentsRoutes);
app.use('/api/notifications', notificationsRoutes);
app.use('/api/uploads', uploadsRoutes);
app.use('/api/admin/files', adminFilesRoutes);
app.use('/api/records', recordAttachmentsRoutes);
app.use('/api/settings', publicSettingsRoutes);
app.use('/api/user', userSettingsRoutes);
app.use('/api/user/settings', comprehensiveSettingsRoutes);
app.use('/api/observations', enhancedObservationsRoutes);
app.use('/api/encounters', enhancedEncountersRoutes);
app.use('/api/self-reporting', selfReportingRoutes);
app.use('/api/analytics', analyticsRoutes);
app.use('/api/profile', profileRoutes);

// Health check endpoints for load balancers and monitoring
app.get('/healthz', (_req, res) => res.status(200).json({ status: 'ok' }));
app.get('/health', (_req, res) => res.status(200).json({ status: 'healthy', timestamp: new Date().toISOString() }));

// Test endpoints - only available in development
if (process.env.NODE_ENV !== 'production') {
  // Test endpoints removed
} // End of test endpoints

// 404 handler
app.use((req, res) => {
	res.status(404).json({ message: 'Not Found', path: req.path });
});

// Error handler
// eslint-disable-next-line @typescript-eslint/no-unused-vars
app.use((err: any, req: express.Request, res: express.Response, _next: express.NextFunction) => {
	const errorId = Math.random().toString(36).substring(7);
	
	// Log full error details internally
	logger.error('Unhandled error', { 
		errorId, 
		error: err, 
		status: err?.status, 
		message: err?.message,
		stack: err?.stack,
		path: req.path,
		method: req.method
	});
	
	// In production, send generic error messages to avoid information leakage
	if (process.env.NODE_ENV === 'production') {
		const status = err?.status || 500;
		const message = status < 500 
			? (err?.message || 'Bad request') 
			: 'Internal server error';
		
		res.status(status).json({ 
			message,
			errorId // Include error ID for support tickets
		});
	} else {
		// In development, send full error details for debugging
		res.status(err?.status || 500).json({ 
			message: err?.message || 'Internal server error',
			errorId,
			stack: err?.stack,
			error: err
		});
	}
});

const PORT = Number(process.env.PORT ?? 3001);
const server = app.listen(PORT, () => {
	logger.info(`Backend server listening on http://localhost:${PORT}`);
});

// Graceful shutdown handler
const gracefulShutdown = async (signal: string) => {
	logger.info(`${signal} received. Starting graceful shutdown...`);
	
	// Stop accepting new connections
	server.close(async () => {
		logger.info('HTTP server closed');
		
		try {
			// Close database connections
			const { PrismaClient } = await import('@prisma/client');
			const prisma = new PrismaClient();
			await prisma.$disconnect();
			logger.info('Database connections closed');
			
			logger.info('Graceful shutdown completed');
			process.exit(0);
		} catch (error) {
			logger.error('Error during shutdown', { error });
			process.exit(1);
		}
	});
	
	// Force shutdown after 30 seconds
	setTimeout(() => {
		logger.error('Forced shutdown after timeout');
		process.exit(1);
	}, 30000);
};

// Register shutdown handlers
process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));

export default app;