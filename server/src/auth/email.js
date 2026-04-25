import { Resend } from 'resend';
import { log } from '../logger.js';

const apiKey = process.env.RESEND_API_KEY;
const fromAddress = process.env.EMAIL_FROM || 'onboarding@resend.dev';
const clientUrl = process.env.CLIENT_URL || 'http://localhost:5173';

const resend = apiKey ? new Resend(apiKey) : null;

if (!resend) {
  log.warn('email.disabled', { reason: 'RESEND_API_KEY not set; emails will be logged not sent' });
}

async function send({ to, subject, html, text }) {
  if (!resend) {
    log.info('email.dev_log', { to, subject, text: text || html });
    return { ok: true, dev: true };
  }
  try {
    const { data, error } = await resend.emails.send({
      from: fromAddress,
      to: [to],
      subject,
      html,
      text,
    });
    if (error) {
      log.error('email.send.fail', { to, subject, err: String(error) });
      return { ok: false, error };
    }
    log.info('email.send.ok', { to, subject, id: data?.id });
    return { ok: true, id: data?.id };
  } catch (err) {
    log.error('email.send.exception', { err: String(err) });
    return { ok: false, error: err };
  }
}

export async function sendVerificationEmail(toEmail, displayName, token) {
  const link = `${clientUrl}/verify-email?token=${encodeURIComponent(token)}`;
  return send({
    to: toEmail,
    subject: 'Verify your Scrabble account',
    html: `
      <div style="font-family: -apple-system, BlinkMacSystemFont, sans-serif; max-width: 480px; margin: 0 auto; padding: 24px;">
        <h2>Welcome, ${escapeHtml(displayName)}!</h2>
        <p>Please verify your email address by clicking the link below:</p>
        <p><a href="${link}" style="display: inline-block; padding: 10px 20px; background: #3b82f6; color: white; text-decoration: none; border-radius: 8px;">Verify email</a></p>
        <p style="color: #94a3b8; font-size: 12px;">If the button doesn't work, paste this URL into your browser:<br>${link}</p>
        <p style="color: #94a3b8; font-size: 12px;">This link expires in 24 hours.</p>
      </div>
    `,
    text: `Welcome to Scrabble! Verify your email: ${link}\n\nThis link expires in 24 hours.`,
  });
}

export async function sendPasswordResetEmail(toEmail, displayName, token) {
  const link = `${clientUrl}/reset-password?token=${encodeURIComponent(token)}`;
  return send({
    to: toEmail,
    subject: 'Reset your Scrabble password',
    html: `
      <div style="font-family: -apple-system, BlinkMacSystemFont, sans-serif; max-width: 480px; margin: 0 auto; padding: 24px;">
        <h2>Hi ${escapeHtml(displayName)},</h2>
        <p>Click the link below to reset your password:</p>
        <p><a href="${link}" style="display: inline-block; padding: 10px 20px; background: #3b82f6; color: white; text-decoration: none; border-radius: 8px;">Reset password</a></p>
        <p style="color: #94a3b8; font-size: 12px;">If you didn't request this, you can safely ignore this email.</p>
        <p style="color: #94a3b8; font-size: 12px;">This link expires in 1 hour.</p>
      </div>
    `,
    text: `Reset your password: ${link}\n\nThis link expires in 1 hour. If you didn't request this, ignore it.`,
  });
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}