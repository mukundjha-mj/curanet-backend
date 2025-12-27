# 🏥 CuraNet - Healthcare Management Platform

[![TypeScript](https://img.shields.io/badge/TypeScript-5.0-blue.svg)](https://www.typescriptlang.org/)
[![Node.js](https://img.shields.io/badge/Node.js-24.x-green.svg)](https://nodejs.org/)
[![Express](https://img.shields.io/badge/Express-5.1-lightgrey.svg)](https://expressjs.com/)
[![Prisma](https://img.shields.io/badge/Prisma-6.16-2D3748.svg)](https://www.prisma.io/)
[![PostgreSQL](https://img.shields.io/badge/PostgreSQL-16-336791.svg)](https://www.postgresql.org/)

A comprehensive, secure, and scalable digital healthcare platform designed for the Indian healthcare ecosystem. CuraNet enables seamless Electronic Health Records (EHR) management with advanced consent-based data sharing, multi-role access control, and HIPAA-compliant security features.

---

## 📋 Table of Contents

- [Features](#-features)
- [Tech Stack](#-tech-stack)
- [System Architecture](#-system-architecture)
- [Getting Started](#-getting-started)
- [Environment Variables](#-environment-variables)
- [API Documentation](#-api-documentation)
- [Database Schema](#-database-schema)
- [Security Features](#-security-features)
- [Development](#-development)
- [Deployment](#-deployment)
- [Testing](#-testing)
- [Contributing](#-contributing)
- [License](#-license)

---

## 🚀 Features

### 1. **Unique Health ID System**
- Every user gets a unique Health ID (`HID-YYYY-XXXXXXXX`)
- Centralized patient identification across all healthcare providers
- Portable medical records across hospitals

### 2. **Multi-Role User Management**
- **Patients**: Manage personal health data, appointments, consent
- **Doctors**: Access patient records, create observations, manage appointments
- **Pharmacies**: View prescriptions, update medication status
- **Admins**: System administration, user management, analytics

### 3. **Comprehensive Medical Records (EHR)**
- **Encounters**: Doctor visits, consultations, diagnoses
- **Observations**: Vital signs (BP, heart rate, glucose, weight, etc.)
- **Prescriptions**: Medication records with dosage and duration
- **Lab Results**: Test reports with reference ranges
- **File Attachments**: X-rays, scans, medical documents (PDF, DICOM, images)
- **Self-Reporting**: Patients can record health data with doctor verification

### 4. **Advanced Consent Management**
- Granular consent control (READ_BASIC, READ_FULL, WRITE, DELETE)
- Time-bound access with automatic expiration
- Consent request workflow with approval/rejection
- Revocable at any time by patient
- Comprehensive audit trail

### 5. **Emergency Data Sharing**
- Generate time-limited emergency access tokens
- Share critical health information without login
- Configurable data scope (allergies, medications, emergency contacts)
- Automatic expiration and access logging

### 6. **Appointment Management**
- Book appointments with doctors
- Status tracking: PENDING → CONFIRMED → COMPLETED/CANCELLED
- Automated email/SMS notifications
- Doctor and patient notes
- Appointment history and analytics

### 7. **Self-Reporting & IoT Integration**
- Patients can record their own health measurements
- IoT device data integration ready
- Photo/file attachments for symptoms
- Doctor verification workflow (PENDING → VERIFIED → REJECTED)
- Device metadata tracking

### 8. **Analytics & Insights**
- Patient health trends (blood pressure, glucose over time)
- Admin dashboard with system metrics
- Appointment statistics
- User engagement analytics
- Consent usage patterns

### 9. **File Management System**
- Secure file upload with encryption
- Chunked upload support for large files
- File sharing with consent validation
- Access logging and audit trail
- Support for medical imaging (DICOM)

### 10. **User Settings & Preferences**
- Appearance settings (dark mode, themes)
- Notification preferences (email, SMS, push)
- Security settings (2FA, session management)
- Privacy controls and data export
- Language preferences

---

## 🛠 Tech Stack

### **Backend Framework**
- **Node.js** v24.1.0 - JavaScript runtime
- **Express** v5.1.0 - Web application framework
- **TypeScript** v5.0.0 - Type-safe JavaScript

### **Database**
- **PostgreSQL** v16 - Primary database
- **Prisma** v6.16.2 - Modern ORM with type safety
- **Neon** - Serverless PostgreSQL (pooling enabled)

### **Authentication & Security**
- **JWT** - JSON Web Tokens (Access + Refresh)
- **Argon2** - Password hashing (military-grade)
- **Helmet** - Security headers (CSP, HSTS, XSS protection)
- **Express Rate Limit** - DDoS protection
- **CORS** - Cross-Origin Resource Sharing
- **Cookie Parser** - Secure HTTP-only cookies

### **Email & Notifications**
- **SendGrid** - Transactional emails
- **Nodemailer** - Email fallback
- **Twilio** (ready) - SMS notifications

### **Logging & Monitoring**
- **Winston** - Structured logging with log rotation
- **APM Hooks** - New Relic, Datadog, Application Insights ready
- **Correlation IDs** - Request tracking across services

### **Development Tools**
- **Nodemon** - Auto-restart on file changes
- **ESLint** - Code linting
- **Prettier** - Code formatting
- **Husky** - Git hooks
- **Docker** - Containerization

---

## 🏗 System Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                     Client Applications                      │
│         (Web App, Mobile App, Admin Dashboard)              │
└─────────────────────┬───────────────────────────────────────┘
                      │ HTTPS/REST API
                      │
┌─────────────────────▼───────────────────────────────────────┐
│                   Express Server (Port 3001)                 │
│  ┌─────────────────────────────────────────────────────┐   │
│  │  Security Layer (Helmet, CORS, Rate Limiting)       │   │
│  └─────────────────────────────────────────────────────┘   │
│  ┌─────────────────────────────────────────────────────┐   │
│  │  Authentication Middleware (JWT Verification)       │   │
│  └─────────────────────────────────────────────────────┘   │
│  ┌─────────────────────────────────────────────────────┐   │
│  │  Request Tracking (Correlation IDs, APM)            │   │
│  └─────────────────────────────────────────────────────┘   │
│  ┌─────────────────────────────────────────────────────┐   │
│  │              API Routes Layer                        │   │
│  │  • /api/auth      • /api/records                     │   │
│  │  • /api/consent   • /api/appointments               │   │
│  │  • /api/uploads   • /api/emergency                  │   │
│  │  • /api/analytics • /api/admin                       │   │
│  └─────────────────────────────────────────────────────┘   │
│  ┌─────────────────────────────────────────────────────┐   │
│  │           Controllers & Business Logic               │   │
│  └─────────────────────────────────────────────────────┘   │
│  ┌─────────────────────────────────────────────────────┐   │
│  │              Services Layer                          │   │
│  │  • AuthService    • ConsentService                   │   │
│  │  • EmailService   • NotificationService             │   │
│  │  • FileService    • AuditService                     │   │
│  └─────────────────────────────────────────────────────┘   │
└─────────────────────┬───────────────────────────────────────┘
                      │ Prisma ORM
                      │
┌─────────────────────▼───────────────────────────────────────┐
│              PostgreSQL Database (Neon)                      │
│  • 36 Tables with relationships                              │
│  • Connection pooling for scalability                        │
│  • Automated backups and migrations                          │
└──────────────────────────────────────────────────────────────┘

┌──────────────────────────────────────────────────────────────┐
│                    External Services                          │
│  • SendGrid (Email)                                           │
│  • Twilio (SMS - ready)                                       │
│  • Cloud Storage (S3 - ready)                                 │
│  • APM Tools (New Relic/Datadog - ready)                      │
└──────────────────────────────────────────────────────────────┘
```

---

## 🚦 Getting Started

### **Prerequisites**
- Node.js v24.x or higher
- PostgreSQL 16 or Neon database
- npm or yarn package manager
- Git

### **Installation**

1. **Clone the repository**
```bash
git clone https://github.com/yourusername/curanet-backend.git
cd curanet-backend
```

2. **Install dependencies**
```bash
npm install
```

3. **Set up environment variables**
```bash
cp .env.example .env
# Edit .env with your configuration
```

4. **Generate Prisma client**
```bash
npm run db:generate
```

5. **Run database migrations**
```bash
npm run db:migrate
```

6. **Seed database (optional)**
```bash
npm run db:seed
```

7. **Start development server**
```bash
npm run dev
```

Server will start at `http://localhost:3001`

### **Quick Start Scripts**
```bash
# Development
npm run dev              # Start with hot reload
npm run type-check       # TypeScript type checking
npm run lint             # Run ESLint
npm run lint:fix         # Fix linting issues

# Database
npm run db:studio        # Open Prisma Studio
npm run db:migrate       # Create migration
npm run db:migrate:prod  # Deploy migrations to production
npm run db:reset         # Reset database (WARNING: deletes all data)

# Production
npm run build            # Build TypeScript
npm start                # Start production server

# Docker
npm run docker:build     # Build Docker image
npm run docker:run       # Run Docker container
npm run docker:compose   # Start with docker-compose
```

---

## 🔐 Environment Variables

Create a `.env` file in the root directory:

```env
# ===================================
# Server Configuration
# ===================================
NODE_ENV=development
PORT=3001
LOG_LEVEL=info

# ===================================
# Database
# ===================================
DATABASE_URL="postgresql://user:password@host:5432/curanet?pgbouncer=true&connection_limit=10"
DATABASE_URL_NON_POOLING="postgresql://user:password@host:5432/curanet"

# ===================================
# Authentication & Security
# ===================================
JWT_SECRET="your-super-secret-jwt-key-min-256-bits"
JWT_REFRESH_SECRET="your-super-secret-refresh-key-min-256-bits"
PASSWORD_PEPPER="your-password-pepper-256-bits"

# ===================================
# CORS & Frontend
# ===================================
CORS_ORIGIN="https://yourdomain.com,https://www.yourdomain.com"
FRONTEND_URL="https://yourdomain.com"

# ===================================
# Email Service (SendGrid)
# ===================================
SENDGRID_API_KEY="your-sendgrid-api-key"
SENDGRID_FROM_EMAIL="noreply@yourdomain.com"
SENDGRID_FROM_NAME="CuraNet Healthcare"

# ===================================
# SMS Service (Twilio - Optional)
# ===================================
TWILIO_ACCOUNT_SID="your-twilio-account-sid"
TWILIO_AUTH_TOKEN="your-twilio-auth-token"
TWILIO_PHONE_NUMBER="+1234567890"

# ===================================
# File Upload
# ===================================
MAX_FILE_SIZE=52428800  # 50MB in bytes
MAX_FILES_PER_REQUEST=10

# ===================================
# APM & Monitoring (Optional)
# ===================================
APM_PROVIDER=""  # newrelic, datadog, applicationinsights, prometheus
NEW_RELIC_LICENSE_KEY=""
DATADOG_API_KEY=""
```

### **Generate Secure Secrets**

```bash
# Generate JWT secrets (Linux/Mac)
node -e "console.log(require('crypto').randomBytes(64).toString('base64'))"

# Windows PowerShell
node -e "console.log(require('crypto').randomBytes(64).toString('base64'))"
```

---

## 📡 API Documentation

### **Base URL**
```
http://localhost:3001/api
```

### **Authentication Endpoints**

#### **POST** `/auth/register`
Register a new user

**Request Body:**
```json
{
  "email": "patient@example.com",
  "password": "SecurePass123!",
  "role": "patient",
  "name": "John Doe",
  "phone": "+919876543210"
}
```

**Response:**
```json
{
  "message": "Registration successful",
  "user": {
    "healthId": "HID-2025-A1B2C3D4",
    "email": "patient@example.com",
    "role": "patient",
    "status": "pending_verification"
  }
}
```

#### **POST** `/auth/login`
Login with email/phone and password

**Request Body:**
```json
{
  "email": "patient@example.com",
  "password": "SecurePass123!"
}
```

**Response:**
```json
{
  "message": "Login successful",
  "user": {
    "healthId": "HID-2025-A1B2C3D4",
    "email": "patient@example.com",
    "role": "patient"
  },
  "accessToken": "eyJhbGciOiJIUzI1NiIs...",
  "refreshToken": "stored-in-httponly-cookie"
}
```

#### **POST** `/auth/refresh`
Refresh access token

**Response:**
```json
{
  "accessToken": "eyJhbGciOiJIUzI1NiIs..."
}
```

#### **POST** `/auth/logout`
Logout and revoke refresh token

### **Consent Management**

#### **POST** `/consent/request`
Request consent from a patient

**Headers:**
```
Authorization: Bearer <access_token>
```

**Request Body:**
```json
{
  "patientHealthId": "HID-2025-A1B2C3D4",
  "purpose": "Treatment consultation",
  "scope": ["READ_BASIC", "READ_OBSERVATIONS"],
  "requestedExpiry": "2025-12-31T23:59:59Z",
  "message": "I need access to review your medical history"
}
```

#### **POST** `/consent/grant`
Grant consent (patient only)

**Request Body:**
```json
{
  "requestId": "clx123456789",
  "endTime": "2025-12-31T23:59:59Z"
}
```

#### **GET** `/consent/list`
List all consents

**Query Parameters:**
- `role` - Filter by role (patient/provider)
- `status` - Filter by status (ACTIVE/REVOKED/EXPIRED)

#### **POST** `/consent/revoke`
Revoke a consent

**Request Body:**
```json
{
  "consentId": "clx123456789",
  "reason": "Treatment completed"
}
```

### **Medical Records**

#### **POST** `/records/encounter`
Create a new encounter

**Request Body:**
```json
{
  "patientHealthId": "HID-2025-A1B2C3D4",
  "type": "CONSULTATION",
  "reason": "Routine checkup",
  "notes": "Patient presenting with fever"
}
```

#### **POST** `/records/observation`
Add an observation

**Request Body:**
```json
{
  "patientHealthId": "HID-2025-A1B2C3D4",
  "encounterId": "clx123456789",
  "code": "blood_pressure",
  "value": { "systolic": 120, "diastolic": 80 },
  "unit": "mmHg"
}
```

#### **GET** `/records/patient/:healthId`
Get patient's medical records

**Response:**
```json
{
  "patient": {
    "healthId": "HID-2025-A1B2C3D4",
    "profile": { ... }
  },
  "encounters": [ ... ],
  "observations": [ ... ],
  "prescriptions": [ ... ]
}
```

### **Appointments**

#### **POST** `/appointments`
Book an appointment

**Request Body:**
```json
{
  "doctorId": "HID-2025-D1D2D3D4",
  "requestedTime": "2025-12-28T10:00:00Z",
  "reasonForVisit": "Annual checkup",
  "duration": 30
}
```

#### **GET** `/appointments`
List appointments

**Query Parameters:**
- `status` - PENDING, CONFIRMED, COMPLETED, CANCELLED
- `date` - Filter by date

#### **PATCH** `/appointments/:id/status`
Update appointment status

**Request Body:**
```json
{
  "status": "CONFIRMED",
  "doctorNotes": "Confirmed for 10 AM slot"
}
```

### **Emergency Sharing**

#### **POST** `/emergency/share`
Create emergency share link

**Request Body:**
```json
{
  "scope": ["ALLERGIES", "MEDICATIONS", "EMERGENCY_CONTACT"],
  "expiresIn": 24
}
```

**Response:**
```json
{
  "shareUrl": "https://curanet.com/emergency/abcd1234",
  "shareId": "abcd1234",
  "expiresAt": "2025-12-28T10:00:00Z"
}
```

#### **GET** `/emergency/access/:shareId`
Access emergency data

### **File Management**

#### **POST** `/uploads/initialize`
Initialize file upload

**Request Body:**
```json
{
  "filename": "xray-chest.jpg",
  "mimeType": "image/jpeg",
  "fileSize": 2048576,
  "category": "XRAY"
}
```

#### **POST** `/uploads/upload`
Upload file

**Form Data:**
```
file: <binary>
uploadToken: <token-from-initialize>
```

#### **GET** `/uploads/files`
List user's files

#### **GET** `/uploads/download/:fileId`
Download file

#### **DELETE** `/uploads/:fileId`
Delete file

### **Analytics**

#### **GET** `/analytics/health-trends`
Get patient health trends

**Query Parameters:**
- `metric` - blood_pressure, glucose, weight, etc.
- `startDate` - Start date for trend
- `endDate` - End date for trend

### **Admin Endpoints**

#### **GET** `/admin/users`
List all users (admin only)

#### **PATCH** `/admin/users/:healthId/status`
Update user status

#### **GET** `/admin/analytics`
System analytics dashboard

---

## 🗄 Database Schema

### **Core Models**

#### **User**
```prisma
model User {
  healthId      String   @id
  email         String?  @unique
  phone         String?  @unique
  role          UserRole
  passwordHash  String
  status        UserStatus
  createdAt     DateTime @default(now())
  updatedAt     DateTime @updatedAt
}
```

#### **Consent**
```prisma
model Consent {
  id           String         @id @default(cuid())
  patientId    String
  providerId   String
  status       ConsentStatus  @default(ACTIVE)
  scope        ConsentScope[]
  permissions  String[]
  purpose      String
  startTime    DateTime       @default(now())
  endTime      DateTime?
  createdAt    DateTime       @default(now())
}
```

#### **Encounter**
```prisma
model Encounter {
  id            String   @id @default(cuid())
  patientId     String
  providerId    String
  type          String
  reason        String?
  startTime     DateTime
  endTime       DateTime?
  notes         String?
  observations  Observation[]
}
```

#### **Observation**
```prisma
model Observation {
  id                 String             @id @default(cuid())
  patientId          String
  providerId         String
  encounterId        String?
  code               String
  value              Json
  unit               String?
  source             ObservationSource  @default(DOCTOR_RECORDED)
  verificationStatus VerificationStatus @default(PENDING)
  recordedAt         DateTime           @default(now())
}
```

**Total Models:** 36 tables including:
- Authentication (RefreshToken, EmailVerification, PasswordResetToken)
- Medical Records (Encounter, Observation, Prescription)
- Consent Management (Consent, ConsentRequest)
- Appointments (Appointment, AppointmentNotification)
- File Management (FileUpload, FileAccess)
- User Settings (SecuritySettings, NotificationSettings, AppearanceSettings)
- Audit (HealthIdAudit, AuditLog)

---

## 🔒 Security Features

### **1. Authentication & Authorization**
- JWT-based authentication with access + refresh tokens
- Refresh token rotation on every use
- HTTP-only cookies for refresh tokens
- Role-based access control (RBAC)
- Device fingerprinting

### **2. Password Security**
- Argon2id hashing algorithm (OWASP recommended)
- Password pepper (application-level secret)
- Minimum password requirements enforced
- Password reset with time-limited tokens

### **3. API Security**
- Helmet security headers (CSP, HSTS, XSS protection)
- CORS with whitelist validation
- Rate limiting (100 req/15min per IP)
- Request size limits
- SQL injection prevention (Prisma ORM)

### **4. Data Privacy**
- Consent-based data access
- Granular permissions (READ_BASIC, READ_FULL, WRITE)
- Time-bound access with auto-expiration
- Comprehensive audit trail
- Data encryption at rest and in transit

### **5. Logging & Monitoring**
- Structured logging with Winston
- Request correlation IDs
- Security event logging
- Failed login attempt tracking
- APM integration ready

### **6. HIPAA Compliance Ready**
- Audit trails for all data access
- Encrypted data transmission (HTTPS)
- Access control and authentication
- Data integrity checks
- Automatic session timeout

### **7. File Upload Security**
- File type validation (whitelist)
- File size limits (50MB default)
- Virus scanning ready
- Secure file storage with encryption
- Access logging

---

## 💻 Development

### **Project Structure**
```
backend/
├── prisma/
│   ├── schema.prisma           # Database schema
│   └── migrations/             # Database migrations
├── src/
│   ├── controllers/            # Route controllers
│   │   ├── auth.controller.ts
│   │   ├── consent.controller.ts
│   │   ├── records.controller.ts
│   │   └── ...
│   ├── routes/                 # API routes
│   │   ├── auth.routes.ts
│   │   ├── consent.routes.ts
│   │   └── ...
│   ├── services/               # Business logic
│   │   ├── email.service.ts
│   │   ├── consent.service.ts
│   │   └── ...
│   ├── middlewares/            # Custom middlewares
│   │   ├── authMiddleware.ts
│   │   ├── consentMiddleware.ts
│   │   └── ...
│   ├── utils/                  # Utility functions
│   │   ├── logger.ts
│   │   ├── prisma.ts
│   │   ├── validation.ts
│   │   └── apm.ts
│   ├── types/                  # TypeScript types
│   │   └── ambient.d.ts
│   └── index.ts                # Entry point
├── tests/                      # Test files
│   ├── unit/
│   ├── integration/
│   └── security/
├── uploads/                    # Uploaded files
├── .env                        # Environment variables
├── .env.example                # Environment template
├── tsconfig.json               # TypeScript config
├── package.json                # Dependencies
├── Dockerfile                  # Docker config
├── docker-compose.yml          # Docker compose
└── README.md                   # This file
```

### **Coding Standards**
- **TypeScript** for type safety
- **ESLint** for code quality
- **Prettier** for code formatting
- **Async/await** for asynchronous code
- **Error handling** with try-catch blocks
- **Winston logger** instead of console.log
- **Prisma best practices** (transactions, optimistic locking)

### **Git Workflow**
```bash
# Create feature branch
git checkout -b feature/your-feature-name

# Make changes and commit
git add .
git commit -m "feat: add new feature"

# Push and create PR
git push origin feature/your-feature-name
```

### **Commit Message Convention**
```
feat: Add new feature
fix: Fix bug
docs: Update documentation
style: Code formatting
refactor: Code refactoring
test: Add tests
chore: Build/config changes
```

---

## 🚀 Deployment

### **Production Checklist**
- [ ] Set `NODE_ENV=production`
- [ ] Generate strong JWT secrets (64+ characters)
- [ ] Configure production DATABASE_URL
- [ ] Set up HTTPS/SSL certificates
- [ ] Configure CORS with production domains
- [ ] Enable rate limiting
- [ ] Set up logging and monitoring
- [ ] Configure email service (SendGrid)
- [ ] Set up automated backups
- [ ] Enable error tracking (Sentry)
- [ ] Configure APM (New Relic/Datadog)
- [ ] Set up CI/CD pipeline
- [ ] Run security audit (`npm audit`)

### **Docker Deployment**

**Build Image:**
```bash
docker build -t curanet-backend:latest .
```

**Run Container:**
```bash
docker run -d \
  --name curanet-backend \
  -p 3001:3001 \
  --env-file .env \
  curanet-backend:latest
```

**Docker Compose:**
```bash
docker-compose up -d
```

### **Cloud Deployment**

#### **Heroku**
```bash
heroku create curanet-backend
heroku addons:create heroku-postgresql:standard-0
git push heroku main
```

#### **AWS EC2**
1. Launch EC2 instance (Ubuntu 22.04)
2. Install Node.js and PostgreSQL
3. Clone repository
4. Set up environment variables
5. Run with PM2: `pm2 start npm --name "curanet" -- start`

#### **Vercel/Railway/Render**
Connect GitHub repository and configure environment variables

---

## 🧪 Testing

### **Run Tests**
```bash
# Unit tests
npm run test:unit

# Integration tests
npm run test:integration

# Security tests
npm run test:security

# All tests
npm test

# Coverage report
npm run test:coverage
```

### **API Testing with Postman**
Import `postman_collection.json` into Postman for pre-configured API tests.

### **Load Testing**
```bash
# Using Apache Bench
ab -n 1000 -c 10 http://localhost:3001/api/healthz

# Using Artillery
artillery quick --count 10 --num 100 http://localhost:3001/api/healthz
```

---

## 📊 Performance

### **Optimization Techniques**
- Database connection pooling (Neon)
- Query optimization with Prisma
- Response caching (Redis ready)
- Pagination for large datasets
- Lazy loading of relationships
- Graceful shutdown handling
- Request batching where applicable

### **Monitoring**
- Winston structured logging
- APM integration (New Relic/Datadog)
- Request duration tracking
- Slow query detection
- Error rate monitoring
- Memory usage tracking

---

## 🤝 Contributing

We welcome contributions! Please follow these steps:

1. Fork the repository
2. Create feature branch (`git checkout -b feature/AmazingFeature`)
3. Commit changes (`git commit -m 'feat: add amazing feature'`)
4. Push to branch (`git push origin feature/AmazingFeature`)
5. Open Pull Request

### **Code Review Guidelines**
- Write clear, descriptive commit messages
- Add tests for new features
- Update documentation
- Follow existing code style
- Ensure all tests pass

---

## 📝 License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

---

## 👥 Team

- **Lead Developer**: [Your Name]
- **Backend Team**: [Team Members]
- **Security Advisor**: [Security Expert]

---

## 📞 Support

- **Documentation**: [https://docs.curanet.com](https://docs.curanet.com)
- **Issue Tracker**: [GitHub Issues](https://github.com/yourusername/curanet-backend/issues)
- **Email**: support@curanet.com
- **Discord**: [Join our community](https://discord.gg/curanet)

---

## 🙏 Acknowledgments

- [Prisma](https://www.prisma.io/) - Amazing ORM
- [Express.js](https://expressjs.com/) - Fast web framework
- [Argon2](https://github.com/ranisalt/node-argon2) - Secure password hashing
- [Winston](https://github.com/winstonjs/winston) - Logging library
- Indian Healthcare Community for requirements and feedback

---

## 📈 Roadmap

### **Q1 2026**
- [ ] Mobile app backend APIs
- [ ] Real-time notifications (WebSocket)
- [ ] Telemedicine video calls integration
- [ ] AI-powered health insights

### **Q2 2026**
- [ ] Multi-language support (Hindi, Tamil, etc.)
- [ ] Blockchain integration for immutable records
- [ ] Advanced analytics dashboard
- [ ] Insurance claim integration

### **Q3 2026**
- [ ] IoT device integration (wearables)
- [ ] Pharmacy inventory management
- [ ] Lab integration APIs
- [ ] Government health ID integration

---

**Made with ❤️ for better healthcare in India**

---

*Last Updated: December 27, 2025*
