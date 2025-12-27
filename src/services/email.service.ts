import nodemailer from 'nodemailer';
import dotenv from 'dotenv';
import axios from 'axios';

dotenv.config();

const FRONTEND_URL = process.env.FRONTEND_URL || 'http://localhost:3000';
const EMAIL_FROM = process.env.EMAIL_FROM || 'no-reply@curanet.local';

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

function buildVerificationHtml(verifyLink: string) {
  return `
    <div style="font-family:Arial,sans-serif;max-width:560px;margin:auto">
      <h2>Verify your email</h2>
      <p>Thanks for signing up for CuraNet. Please verify your email by clicking the button below:</p>
      <p><a href="${verifyLink}" style="display:inline-block;padding:10px 16px;background:#0ea5e9;color:#fff;border-radius:6px;text-decoration:none">Verify Email</a></p>
      <p>Or copy and paste this link into your browser:</p>
      <p><a href="${verifyLink}">${verifyLink}</a></p>
    </div>
  `;
}

export async function sendVerificationEmail(to: string, token: string) {
  const verifyLink = `${FRONTEND_URL}/auth/verify?token=${encodeURIComponent(token)}`;
  const html = buildVerificationHtml(verifyLink);
  const sgKey = process.env.SENDGRID_API_KEY || process.env.SENDGRID_KEY; // allow either name
  if (sgKey) {
    try {
      await axios.post('https://api.sendgrid.com/v3/mail/send', {
        personalizations: [{ to: [{ email: to }], subject: 'Verify your email' }],
        from: { email: EMAIL_FROM },
        content: [{ type: 'text/html', value: html }]
      }, {
        headers: {
          Authorization: `Bearer ${sgKey}`,
          'Content-Type': 'application/json'
        }
      });
      return;
    } catch (err) {
      console.warn('[Email] SendGrid API send failed, falling back to SMTP/Ethereal', err instanceof Error ? err.message : err);
    }
  }
  const transporter = await getTransport();
  const info = await transporter.sendMail({ from: EMAIL_FROM, to, subject: 'Verify your email', html });
  const preview = nodemailer.getTestMessageUrl(info);
  if (preview) console.info(`[DEV] Email preview URL: ${preview}`);
}

function buildOtpHtml(otp: string) {
  return `
    <div style="font-family:Arial,sans-serif;max-width:560px;margin:auto">
      <h2>Email Verification Code</h2>
      <p>Your OTP for email verification is:</p>
      <div style="font-size:32px;font-weight:bold;color:#0ea5e9;letter-spacing:8px;text-align:center;padding:20px;background:#f3f4f6;border-radius:8px;margin:20px 0">
        ${otp}
      </div>
      <p>This code will expire in 10 minutes.</p>
      <p>If you didn't request this, please ignore this email.</p>
    </div>
  `;
}

export async function sendEmailOtp(to: string, otp: string) {
  const html = buildOtpHtml(otp);
  
  // In development, log OTP to console
  if (process.env.NODE_ENV !== 'production') {
    console.info(`[DEV] Email OTP for ${to}: ${otp}`);
    console.info(`[DEV] This OTP will expire in 10 minutes`);
  }

  const sgKey = process.env.SENDGRID_API_KEY || process.env.SENDGRID_KEY;
  if (sgKey) {
    try {
      await axios.post('https://api.sendgrid.com/v3/mail/send', {
        personalizations: [{ to: [{ email: to }], subject: 'CuraNet - Email Verification Code' }],
        from: { email: EMAIL_FROM },
        content: [{ type: 'text/html', value: html }]
      }, {
        headers: {
          Authorization: `Bearer ${sgKey}`,
          'Content-Type': 'application/json'
        }
      });
      return true;
    } catch (err) {
      console.warn('[Email] SendGrid API send failed, falling back to SMTP/Ethereal', err instanceof Error ? err.message : err);
    }
  }
  
  try {
    const transporter = await getTransport();
    const info = await transporter.sendMail({ 
      from: EMAIL_FROM, 
      to, 
      subject: 'CuraNet - Email Verification Code', 
      html 
    });
    const preview = nodemailer.getTestMessageUrl(info);
    if (preview) console.info(`[DEV] Email preview URL: ${preview}`);
    return true;
  } catch (error) {
    console.error('Failed to send email OTP:', error);
    return false;
  }
}

export default {
  sendVerificationEmail,
  sendEmailOtp,
};
