/**
 * Application Performance Monitoring (APM) Utility
 * 
 * Provides hooks for integrating APM solutions like New Relic, Datadog, 
 * Application Insights, or custom monitoring solutions.
 * 
 * Features:
 * - Request tracking with correlation IDs
 * - Custom metrics and counters
 * - Performance timing
 * - Error tracking
 * - Business metrics
 */

import { Request, Response, NextFunction } from 'express';
import logger from './logger';

// Generate correlation ID for request tracking
export const generateCorrelationId = (): string => {
  return `${Date.now()}-${Math.random().toString(36).substring(2, 15)}`;
};

/**
 * Request tracking middleware
 * Adds correlation ID and tracks request timing
 */
export const requestTracking = (req: Request, res: Response, next: NextFunction): void => {
  const correlationId = req.headers['x-correlation-id'] as string || generateCorrelationId();
  const startTime = Date.now();
  
  // Add correlation ID to request for use in logs
  (req as any).correlationId = correlationId;
  
  // Add correlation ID to response headers
  res.setHeader('X-Correlation-ID', correlationId);
  
  // Track response
  res.on('finish', () => {
    const duration = Date.now() - startTime;
    const { method, originalUrl, ip } = req;
    const { statusCode } = res;
    
    // Log request details with correlation ID
    logger.info('Request completed', {
      correlationId,
      method,
      url: originalUrl,
      statusCode,
      duration,
      ip,
      userAgent: req.headers['user-agent']
    });
    
    // INTEGRATION POINT: Send metrics to APM service
    // Example for New Relic:
    // if (global.newrelic) {
    //   global.newrelic.recordMetric('Custom/API/ResponseTime', duration);
    //   global.newrelic.recordMetric(`Custom/API/StatusCode/${statusCode}`, 1);
    // }
    
    // Example for Datadog:
    // if (global.ddTrace) {
    //   global.ddTrace.dogstatsd.histogram('api.response_time', duration, [`endpoint:${originalUrl}`, `status:${statusCode}`]);
    // }
    
    // Example for Application Insights:
    // if (global.appInsights) {
    //   global.appInsights.defaultClient.trackMetric({ name: 'API Response Time', value: duration });
    //   global.appInsights.defaultClient.trackRequest({ name: `${method} ${originalUrl}`, resultCode: statusCode, duration });
    // }
    
    // Track slow requests (> 1 second)
    if (duration > 1000) {
      logger.warn('Slow request detected', {
        correlationId,
        method,
        url: originalUrl,
        duration,
        threshold: 1000
      });
      
      trackMetric('slow_requests', 1, { endpoint: originalUrl });
    }
    
    // Track errors
    if (statusCode >= 500) {
      trackMetric('server_errors', 1, { endpoint: originalUrl, status: statusCode });
    } else if (statusCode >= 400) {
      trackMetric('client_errors', 1, { endpoint: originalUrl, status: statusCode });
    }
  });
  
  next();
};

/**
 * Custom metric tracking
 * @param name Metric name
 * @param value Metric value
 * @param tags Additional tags/dimensions
 */
export const trackMetric = (name: string, value: number, tags: Record<string, any> = {}): void => {
  logger.debug('Custom metric', { metric: name, value, tags });
  
  // INTEGRATION POINT: Send to APM service
  // Example implementations:
  
  // New Relic:
  // if (global.newrelic) {
  //   global.newrelic.recordMetric(`Custom/${name}`, value);
  // }
  
  // Datadog:
  // if (global.ddTrace?.dogstatsd) {
  //   const tagArray = Object.entries(tags).map(([k, v]) => `${k}:${v}`);
  //   global.ddTrace.dogstatsd.gauge(name, value, tagArray);
  // }
  
  // Application Insights:
  // if (global.appInsights) {
  //   global.appInsights.defaultClient.trackMetric({ 
  //     name, 
  //     value, 
  //     properties: tags 
  //   });
  // }
  
  // Prometheus (using prom-client):
  // if (global.prometheusRegistry) {
  //   const gauge = new global.promClient.Gauge({
  //     name: name.replace(/[^a-zA-Z0-9_]/g, '_'),
  //     help: `Custom metric: ${name}`,
  //     labelNames: Object.keys(tags),
  //     registers: [global.prometheusRegistry]
  //   });
  //   gauge.set(tags, value);
  // }
};

/**
 * Track business events
 * @param event Event name (e.g., 'user.registered', 'appointment.booked')
 * @param properties Event properties
 */
export const trackEvent = (event: string, properties: Record<string, any> = {}): void => {
  logger.info('Business event', { event, properties });
  
  // INTEGRATION POINT: Send to analytics/APM
  // Example implementations:
  
  // Application Insights:
  // if (global.appInsights) {
  //   global.appInsights.defaultClient.trackEvent({ 
  //     name: event, 
  //     properties 
  //   });
  // }
  
  // Custom analytics service:
  // await analyticsService.track(event, properties);
};

/**
 * Track exceptions/errors
 * @param error Error object
 * @param context Additional context
 */
export const trackException = (error: Error, context: Record<string, any> = {}): void => {
  logger.error('Exception tracked', { 
    error: error.message, 
    stack: error.stack,
    context 
  });
  
  // INTEGRATION POINT: Send to error tracking service
  
  // Sentry:
  // if (global.Sentry) {
  //   global.Sentry.captureException(error, { extra: context });
  // }
  
  // Application Insights:
  // if (global.appInsights) {
  //   global.appInsights.defaultClient.trackException({ 
  //     exception: error, 
  //     properties: context 
  //   });
  // }
  
  // New Relic:
  // if (global.newrelic) {
  //   global.newrelic.noticeError(error, context);
  // }
};

/**
 * Database query performance tracking
 */
export class QueryPerformanceTracker {
  private startTime: number;
  private queryName: string;
  
  constructor(queryName: string) {
    this.queryName = queryName;
    this.startTime = Date.now();
  }
  
  end(): void {
    const duration = Date.now() - this.startTime;
    
    logger.debug('Database query completed', {
      query: this.queryName,
      duration
    });
    
    trackMetric('db_query_duration', duration, { query: this.queryName });
    
    // Track slow queries (> 100ms)
    if (duration > 100) {
      logger.warn('Slow database query', {
        query: this.queryName,
        duration,
        threshold: 100
      });
      
      trackMetric('slow_db_queries', 1, { query: this.queryName });
    }
  }
}

/**
 * Initialize APM (call this in index.ts before importing other modules)
 */
export const initializeAPM = (): void => {
  const apmProvider = process.env.APM_PROVIDER;
  
  if (!apmProvider || apmProvider === 'none') {
    logger.info('APM disabled');
    return;
  }
  
  logger.info(`Initializing APM provider: ${apmProvider}`);
  
  try {
    switch (apmProvider.toLowerCase()) {
      case 'newrelic':
        // require('newrelic'); // Must be first import in index.ts
        logger.info('New Relic APM initialized');
        break;
        
      case 'datadog':
        // const tracer = require('dd-trace').init({
        //   service: 'curanet-backend',
        //   env: process.env.NODE_ENV || 'development'
        // });
        // global.ddTrace = tracer;
        logger.info('Datadog APM initialized');
        break;
        
      case 'appinsights':
        // const appInsights = require('applicationinsights');
        // appInsights.setup(process.env.APPLICATIONINSIGHTS_CONNECTION_STRING)
        //   .setAutoDependencyCorrelation(true)
        //   .setAutoCollectRequests(true)
        //   .setAutoCollectPerformance(true)
        //   .setAutoCollectExceptions(true)
        //   .setAutoCollectDependencies(true)
        //   .start();
        // global.appInsights = appInsights;
        logger.info('Application Insights initialized');
        break;
        
      case 'prometheus':
        // const promClient = require('prom-client');
        // const register = new promClient.Registry();
        // promClient.collectDefaultMetrics({ register });
        // global.prometheusRegistry = register;
        // global.promClient = promClient;
        logger.info('Prometheus metrics initialized');
        break;
        
      default:
        logger.warn(`Unknown APM provider: ${apmProvider}`);
    }
  } catch (error) {
    logger.error('Failed to initialize APM', { error });
  }
};

export default {
  requestTracking,
  trackMetric,
  trackEvent,
  trackException,
  QueryPerformanceTracker,
  initializeAPM,
  generateCorrelationId
};
