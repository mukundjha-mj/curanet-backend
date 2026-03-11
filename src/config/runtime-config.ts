import dotenv from 'dotenv'

dotenv.config()

const requireEnv = (name: string): string => {
  const value = process.env[name]
  if (!value || value.trim().length === 0) {
    throw new Error(`${name} is required in .env`)
  }
  return value.trim()
}

const requireInt = (name: string): number => {
  const raw = requireEnv(name)
  const parsed = Number.parseInt(raw, 10)

  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error(`${name} must be a positive integer, received: ${raw}`)
  }

  return parsed
}

const requireBoolean = (name: string): boolean => {
  const normalized = requireEnv(name).toLowerCase()

  if (["true", "1", "yes", "y", "on"].includes(normalized)) {
    return true
  }
  if (["false", "0", "no", "n", "off"].includes(normalized)) {
    return false
  }

  throw new Error(`${name} must be a boolean (true/false), received: ${normalized}`)
}

const requireSameSite = (): "strict" | "lax" | "none" => {
  const value = requireEnv("COOKIE_SAME_SITE").toLowerCase()

  if (value === "strict" || value === "lax" || value === "none") {
    return value
  }

  throw new Error(`COOKIE_SAME_SITE must be one of: strict, lax, none. Received: ${value}`)
}

export const runtimeConfig = {
  rateLimitWindowMinutes: requireInt("RATE_LIMIT_WINDOW_MINUTES"),
  rateLimitMaxRequests: requireInt("RATE_LIMIT_MAX_REQUESTS"),
  authRateLimitMax: requireInt("AUTH_RATE_LIMIT_MAX"),
  strictRateLimitWindowSeconds: requireInt("STRICT_RATE_LIMIT_WINDOW_SECONDS"),
  strictRateLimitMax: requireInt("STRICT_RATE_LIMIT_MAX"),

  jwtAccessTokenExpiryWeb: requireEnv("JWT_ACCESS_TOKEN_EXPIRY_WEB"),
  jwtAccessTokenExpiryMobile: requireEnv("JWT_ACCESS_TOKEN_EXPIRY_MOBILE"),
  jwtRefreshTokenExpiryDays: requireInt("JWT_REFRESH_TOKEN_EXPIRY_DAYS"),

  emailVerificationTokenExpiryHours: requireInt("EMAIL_VERIFICATION_TOKEN_EXPIRY_HOURS"),
  passwordResetTokenExpiryHours: requireInt("PASSWORD_RESET_TOKEN_EXPIRY_HOURS"),

  argon2MemoryCost: requireInt("ARGON2_MEMORY_COST"),
  argon2TimeCost: requireInt("ARGON2_TIME_COST"),
  argon2Parallelism: requireInt("ARGON2_PARALLELISM"),

  passwordMinLength: requireInt("PASSWORD_MIN_LENGTH"),

  otpLength: requireInt("OTP_LENGTH"),
  otpExpiryMinutes: requireInt("OTP_EXPIRY_MINUTES"),
  otpMaxFailedAttempts: requireInt("OTP_MAX_FAILED_ATTEMPTS"),

  selfReportingRateLimit: requireInt("SELF_REPORTING_RATE_LIMIT"),
  selfReportingRateWindowMinutes: requireInt("SELF_REPORTING_RATE_WINDOW_MINUTES"),

  maxFileSizeBytes: requireInt("MAX_FILE_SIZE_BYTES"),
  maxJsonBodySizeMb: requireInt("MAX_JSON_BODY_SIZE_MB"),

  hstsMaxAge: requireInt("HSTS_MAX_AGE"),
  cookieSameSite: requireSameSite(),
  cookieSecure: requireBoolean("COOKIE_SECURE"),

  maxLoginAttempts: requireInt("MAX_LOGIN_ATTEMPTS"),
  loginAttemptLockoutMinutes: requireInt("LOGIN_ATTEMPT_LOCKOUT_MINUTES"),

  emergencyShareMaxExpirySeconds: requireInt("EMERGENCY_SHARE_MAX_EXPIRY_SECONDS"),
  emergencyShareDefaultExpirySeconds: requireInt("EMERGENCY_SHARE_DEFAULT_EXPIRY_SECONDS"),
  sessionTimeoutMinutes: requireInt("SESSION_TIMEOUT_MINUTES"),
  consentExpiryDays: requireInt("CONSENT_EXPIRY_DAYS"),
  emergencyShareExpiryHours: requireInt("EMERGENCY_SHARE_EXPIRY_HOURS"),
  consentRequestExpiryHoursProd: requireInt("CONSENT_REQUEST_EXPIRY_HOURS"),
  consentRequestExpiryHoursDev: requireInt("CONSENT_REQUEST_EXPIRY_HOURS_DEV"),
}

export default runtimeConfig
