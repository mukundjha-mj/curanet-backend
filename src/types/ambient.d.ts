// Ambient declarations to satisfy TypeScript in absence of local type definitions

declare namespace NodeJS {
  interface ProcessEnv {
    // Environment
    NODE_ENV?: string;
    PORT?: string;
    
    // Database
    DATABASE_URL?: string;
    
    // JWT Authentication
    JWT_SECRET?: string;
    JWT_REFRESH_SECRET?: string;
    PASSWORD_PEPPER?: string;
    
    // CORS & URLs
    CORS_ORIGIN?: string;
    FRONTEND_URL?: string;
    BASE_URL?: string;
    
    // File Upload
    MAX_FILE_SIZE?: string;
    MAX_FILES_PER_REQUEST?: string;
    
    // AI Integration
    GROQ_API_KEY?: string;
    
    // Email (SMTP/SendGrid)
    SMTP_HOST?: string;
    SMTP_PORT?: string;
    SMTP_USER?: string;
    SMTP_PASS?: string;
    SENDGRID_API_KEY?: string;
    SENDGRID_KEY?: string;
    EMAIL_FROM?: string;
    
    // Admin
    ADMIN_BOOTSTRAP_TOKEN?: string;
    
    // Logging
    LOG_LEVEL?: string;
    
    // APM/Monitoring
    APM_PROVIDER?: string;
    APM_CONNECTION_STRING?: string;
  }
}

declare module '../models/*' {
  const anyModel: any;
  export default anyModel;
}

declare module '../../ride/service/*' {
  export function subscribeToQueue(queue: string, cb: (msg: any) => void): void;
}
