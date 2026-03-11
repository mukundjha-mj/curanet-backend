import nodemailer from 'nodemailer';
import dotenv from 'dotenv';
import { Resend } from 'resend';

dotenv.config();

function normalizePublicAppUrl(rawValue: string, envName: string): string {
  const primaryValue = rawValue
    .split(',')
    .map((entry) => entry.trim())
    .find((entry) => entry.length > 0);

  if (!primaryValue) {
    throw new Error(`${envName} is set but does not contain a valid URL`);
  }

  let parsed: URL;
  try {
    parsed = new URL(primaryValue);
  } catch {
    throw new Error(`${envName} must be a valid absolute URL like "https://curanet.in"`);
  }

  parsed.hash = '';
  parsed.search = '';
  parsed.pathname = parsed.pathname.replace(/\/$/, '');

  return parsed.toString().replace(/\/$/, '');
}

function buildFrontendLink(baseUrl: string, pathname: string, queryKey: string, token: string): string {
  const url = new URL(pathname, `${baseUrl}/`);
  url.searchParams.set(queryKey, token);
  return url.toString();
}

const getFrontendUrl = (): string => {
  const value = process.env.FRONTEND_URL;
  if (!value) {
    throw new Error('FRONTEND_URL is not set in environment variables');
  }
  return normalizePublicAppUrl(value, 'FRONTEND_URL');
};

const getEmailFrom = (): string => {
  const value = process.env.EMAIL_FROM;
  if (!value) {
    throw new Error('EMAIL_FROM is not set in environment variables');
  }
  return value;
};

const FRONTEND_URL = getFrontendUrl();
const EMAIL_FROM = getEmailFrom();
const RESEND_API_KEY = process.env.RESEND_API_KEY;
const PUBLIC_EMAIL_PROVIDERS = new Set([
  'gmail.com',
  'googlemail.com',
  'yahoo.com',
  'outlook.com',
  'hotmail.com',
  'live.com',
  'icloud.com',
  'aol.com',
  'proton.me',
  'protonmail.com',
]);

const resend = RESEND_API_KEY ? new Resend(RESEND_API_KEY) : null;

function extractEmailAddress(input: string): string {
  const match = input.match(/<([^>]+)>/);
  return (match ? match[1] : input).trim().toLowerCase();
}

function getEmailDomain(input: string): string {
  const email = extractEmailAddress(input);
  const atIndex = email.lastIndexOf('@');

  if (atIndex === -1 || atIndex === email.length - 1) {
    throw new Error('EMAIL_FROM must be a valid email address or display-name format like "CuraNet <noreply@curanet.in>"');
  }

  return email.slice(atIndex + 1);
}

function validateEmailProviderConfiguration(): void {
  const senderDomain = getEmailDomain(EMAIL_FROM);
  const verifiedDomain = process.env.RESEND_VERIFIED_DOMAIN?.trim().toLowerCase();

  if (resend && PUBLIC_EMAIL_PROVIDERS.has(senderDomain)) {
    throw new Error(
      `EMAIL_FROM uses public mailbox domain "${senderDomain}" which Resend will reject. Use a sender on your verified domain, for example "CuraNet <noreply@curanet.in>".`
    );
  }

  if (resend && verifiedDomain && senderDomain !== verifiedDomain) {
    throw new Error(
      `EMAIL_FROM domain "${senderDomain}" does not match RESEND_VERIFIED_DOMAIN "${verifiedDomain}".`
    );
  }
}

validateEmailProviderConfiguration();

async function sendEmailWithProviders(to: string, subject: string, html: string) {
  // Priority 1: Resend
  if (resend) {
    try {
      await resend.emails.send({
        from: EMAIL_FROM,
        to,
        subject,
        html,
      });
      return;
    } catch (err) {
      console.warn('[Email] Resend send failed, falling back to SMTP/Ethereal', err instanceof Error ? err.message : err);
    }
  }

  // Priority 2: SMTP / Ethereal fallback
  const transporter = await getTransport();
  const info = await transporter.sendMail({ from: EMAIL_FROM, to, subject, html });
  const preview = nodemailer.getTestMessageUrl(info);
  if (preview) console.info(`[DEV] Email preview URL: ${preview}`);
}

async function getTransport() {
  const host = process.env.SMTP_HOST;
  const port = process.env.SMTP_PORT ? Number(process.env.SMTP_PORT) : undefined;
  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASS;
  if (host && port && user && pass) {
    return nodemailer.createTransport({
      host,
      port,
      secure: port === 465,
      auth: { user, pass },
    });
  }
  // Dev fallback: Ethereal
  const testAccount = await nodemailer.createTestAccount();
  return nodemailer.createTransport({
    host: 'smtp.ethereal.email',
    port: 587,
    secure: false,
    auth: {
      user: testAccount.user,
      pass: testAccount.pass,
    },
  });
}

function buildEmailLayout(params: {
  title: string;
  subtitle: string;
  bodyHtml: string;
}) {
  return `
    <div style="margin:0;padding:24px;background:#f4f7fb;font-family:Segoe UI,Arial,sans-serif;color:#10233a;">
      <div style="max-width:640px;margin:0 auto;background:#ffffff;border:1px solid #e5edf7;border-radius:16px;overflow:hidden;box-shadow:0 8px 30px rgba(15,23,42,.06);">
        <div style="padding:24px 28px;background:linear-gradient(135deg,#0f172a,#1e3a8a);color:#fff;">
          <div style="font-size:20px;font-weight:700;letter-spacing:.2px;">CuraNet</div>
          <div style="font-size:13px;opacity:.9;margin-top:4px;">Healthcare Platform</div>
        </div>
        <div style="padding:28px;">
          <h2 style="margin:0 0 8px 0;font-size:24px;line-height:1.3;color:#0f172a;">${params.title}</h2>
          <p style="margin:0 0 20px 0;font-size:15px;line-height:1.6;color:#334155;">${params.subtitle}</p>
          ${params.bodyHtml}
        </div>
        <div style="padding:16px 28px;background:#f8fbff;border-top:1px solid #e5edf7;font-size:12px;color:#64748b;line-height:1.6;">
          Sent by CuraNet. If this wasn't you, you can safely ignore this email.
        </div>
      </div>
    </div>
  `;
}

function buildVerificationHtml(verifyLink: string) {
  return buildEmailLayout({
    title: 'Verify your email',
    subtitle: 'Welcome to CuraNet. Confirm your email to activate your account and keep your health data secure.',
    bodyHtml: `
      <p style="margin:0 0 16px 0;font-size:14px;color:#334155;">This verification link is valid for 24 hours.</p>
      <a href="${verifyLink}" style="display:inline-block;padding:12px 20px;background:#1d4ed8;color:#fff;border-radius:10px;text-decoration:none;font-weight:600;">Verify Email</a>
      <p style="margin:18px 0 8px 0;font-size:13px;color:#64748b;">Or copy and paste this link:</p>
      <p style="margin:0;font-size:13px;word-break:break-all;"><a href="${verifyLink}" style="color:#1d4ed8;">${verifyLink}</a></p>
    `,
  });
}

export async function sendVerificationEmail(to: string, token: string) {
  const verifyLink = buildFrontendLink(FRONTEND_URL, '/verify', 'token', token);
  const html = buildVerificationHtml(verifyLink);
  await sendEmailWithProviders(to, 'CuraNet - Verify your email', html);
}

function buildOtpHtml(otp: string) {
  return buildEmailLayout({
    title: 'Your verification code',
    subtitle: 'Use this one-time code to verify your email on CuraNet.',
    bodyHtml: `
      <div style="font-size:34px;font-weight:700;letter-spacing:10px;text-align:center;padding:20px;background:#eff6ff;border:1px dashed #bfdbfe;border-radius:12px;margin:8px 0 16px;">
        ${otp}
      </div>
      <p style="margin:0;font-size:14px;color:#334155;">This code expires in <strong>10 minutes</strong>.</p>
    `,
  });
}

export async function sendEmailOtp(to: string, otp: string) {
  const html = buildOtpHtml(otp);
  
  // In development, log OTP to console
  if (process.env.NODE_ENV !== 'production') {
    console.info(`[DEV] Email OTP for ${to}: ${otp}`);
    console.info(`[DEV] This OTP will expire in 10 minutes`);
  }

  try {
    await sendEmailWithProviders(to, 'CuraNet - Email Verification Code', html);
    return true;
  } catch (error) {
    console.error('Failed to send email OTP:', error);
    return false;
  }
}

function buildPasswordResetHtml(resetLink: string) {
  return buildEmailLayout({
    title: 'Reset your password',
    subtitle: 'A request was made to reset your CuraNet password.',
    bodyHtml: `
      <p style="margin:0 0 16px 0;font-size:14px;color:#334155;">Use the button below to create a new password. This link expires in <strong>1 hour</strong>.</p>
      <a href="${resetLink}" style="display:inline-block;padding:12px 20px;background:#2563eb;color:#fff;border-radius:10px;text-decoration:none;font-weight:600;">Reset Password</a>
      <p style="margin:18px 0 8px 0;font-size:13px;color:#64748b;">Or copy and paste this link:</p>
      <p style="margin:0;font-size:13px;word-break:break-all;"><a href="${resetLink}" style="color:#2563eb;">${resetLink}</a></p>
    `,
  });
}

export async function sendPasswordResetEmail(to: string, token: string) {
  const resetLink = buildFrontendLink(FRONTEND_URL, '/reset-password', 'token', token);
  const html = buildPasswordResetHtml(resetLink);
  await sendEmailWithProviders(to, 'CuraNet - Reset your password', html);
}

function buildWelcomeHtml(displayName?: string) {
  const safeName = displayName?.trim() ? displayName.trim() : 'there';
  return buildEmailLayout({
    title: `Welcome to CuraNet, ${safeName}`,
    subtitle: 'Your account is created. We are glad to have you on board.',
    bodyHtml: `
      <div style="padding:14px 16px;border:1px solid #dbeafe;background:#f8fafc;border-radius:12px;margin-bottom:16px;">
        <p style="margin:0;font-size:14px;color:#334155;">You can now sign in, complete your profile, and start managing your appointments and medical records securely.</p>
      </div>
      <a href="${FRONTEND_URL}" style="display:inline-block;padding:12px 20px;background:#0f766e;color:#fff;border-radius:10px;text-decoration:none;font-weight:600;">Open CuraNet</a>
    `,
  });
}

export async function sendWelcomeEmail(to: string, displayName?: string) {
  const html = buildWelcomeHtml(displayName);
  await sendEmailWithProviders(to, 'Welcome to CuraNet', html);
}

export default {
  sendVerificationEmail,
  sendEmailOtp,
  sendPasswordResetEmail,
  sendWelcomeEmail,
};
