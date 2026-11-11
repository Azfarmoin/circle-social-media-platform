import nodemailer from 'nodemailer';
import { env } from '../config/env.js';
import { logger } from '../config/logger.js';

// With SMTP_URL set, mail goes out over SMTP. Without it, messages are logged (dev) and kept in an
// in-memory outbox that tests read to pick up verification and reset links.
const transport = env.SMTP_URL ? nodemailer.createTransport(env.SMTP_URL) : nodemailer.createTransport({ jsonTransport: true });

export const outbox = [];

export async function sendMail({ to, subject, text }) {
  const message = { from: env.MAIL_FROM, to, subject, text };
  if (!env.SMTP_URL) {
    outbox.push({ ...message, at: Date.now() });
    if (outbox.length > 200) outbox.shift();
    if (!env.isTest) logger.info({ to, subject, text }, 'mail (not sent, no SMTP_URL configured)');
    return;
  }
  try {
    await transport.sendMail(message);
  } catch (err) {
    logger.error({ err: err.message, to, subject }, 'failed to send mail');
  }
}

export const lastMailTo = (to) => [...outbox].reverse().find((m) => m.to === to);

export const mailTemplates = {
  verify: (name, url) => ({
    subject: 'Confirm your Circle email address',
    text: `Hi ${name || 'there'},\n\nConfirm your email address to finish setting up your account:\n${url}\n\nThis link expires in 24 hours. If you did not sign up, ignore this email.`,
  }),
  reset: (name, url) => ({
    subject: 'Reset your Circle password',
    text: `Hi ${name || 'there'},\n\nUse this link to choose a new password:\n${url}\n\nThe link expires in 1 hour. If you did not request it, you can ignore this email.`,
  }),
  newDevice: (name, device, ip) => ({
    subject: 'New sign-in to your Circle account',
    text: `Hi ${name || 'there'},\n\nWe noticed a sign-in from ${device} (IP ${ip || 'unknown'}).\nIf this was you, no action is needed. If not, change your password and review your active sessions in Settings > Security.`,
  }),
  passwordChanged: (name) => ({
    subject: 'Your Circle password was changed',
    text: `Hi ${name || 'there'},\n\nYour password was just changed and your other sessions were signed out. If this was not you, reset your password immediately.`,
  }),
  friendRequest: (name, from) => ({
    subject: `${from} sent you a friend request`,
    text: `Hi ${name || 'there'},\n\n${from} wants to be your friend on Circle. Open the app to respond.`,
  }),
};
