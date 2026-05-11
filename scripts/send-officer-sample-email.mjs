#!/usr/bin/env node
/**
 * Sends one **test** sample "officer email" (bail-details style) via Gmail SMTP.
 * Subject and body are prefixed so it is obvious this is not a live client email.
 *
 * Requires a Google Account **App Password** (not your normal password):
 *   Google Account → Security → 2-Step Verification → App passwords
 *
 * Usage (PowerShell):
 *   $env:GMAIL_USER="robertdavidcashman@gmail.com"
 *   $env:GMAIL_APP_PASSWORD="xxxx xxxx xxxx xxxx"
 *   npm run email:sample-officer
 *
 * Optional:
 *   SAMPLE_TO          — inbox that receives the mail (default: same as GMAIL_USER)
 *   OFFICER_EMAIL      — if set, mail is addressed To this officer and SAMPLE_TO is BCC'd
 */

import nodemailer from 'nodemailer';

const sample = {
  officerSurname: 'Taylor',
  attendanceDate: '2026-04-30',
  attendanceTime: '14:30',
  clientName: 'Jane Doe',
  matter: 'Common assault',
  attendanceNote:
    'My client was interviewed under caution and gave an account in interview; we await disclosure of custody CCTV and body-worn footage referenced on the custody record.',
};

function formatDateForEmail(dateValue) {
  if (!dateValue) return '[Date]';
  const date = new Date(dateValue + 'T00:00:00');
  if (Number.isNaN(date.getTime())) return '[Date]';
  return date.toLocaleDateString('en-GB', {
    weekday: 'long',
    day: '2-digit',
    month: 'long',
    year: 'numeric',
  });
}

const TEST_TAG = '[TEST — Custody Note sample officer email]';

function buildSubject(data) {
  return `${TEST_TAG} Bail details request – ${data.clientName} – ${data.matter}`;
}

function buildBody(data) {
  const note = (data.attendanceNote || '').trim();
  const officerLetter =
    `Dear Officer ${data.officerSurname},\n\n` +
    `I am writing in relation to ${data.clientName}, whom I attended on ${formatDateForEmail(data.attendanceDate)} at ${data.attendanceTime} in respect of ${data.matter}.\n\n` +
    (note ? `${note}\n\n` : '') +
    'Please could you confirm the bail return date, time, and any bail conditions imposed.\n\n' +
    'Kind regards,\n[Your name]';

  return (
    '*** TEST EMAIL ONLY — fictional names/details; do not use for disclosure or court. ***\n' +
    '(Sent by: npm run email:sample-officer)\n\n' +
    '--- Officer-style draft below ---\n\n' +
    officerLetter
  );
}

const user = process.env.GMAIL_USER?.trim();
const pass = process.env.GMAIL_APP_PASSWORD?.trim().replace(/\s+/g, '');
const sampleTo = process.env.SAMPLE_TO?.trim() || user;
const officerTo = process.env.OFFICER_EMAIL?.trim();

if (!user || !pass) {
  console.error(
    '[send-officer-sample-email] Set GMAIL_USER and GMAIL_APP_PASSWORD (Google App Password).\n' +
      'Example (PowerShell):\n' +
      '  $env:GMAIL_USER="you@gmail.com"\n' +
      '  $env:GMAIL_APP_PASSWORD="yourapppassword"\n' +
      '  npm run email:sample-officer'
  );
  process.exit(1);
}

const subject = buildSubject(sample);
const text = buildBody(sample);

const transporter = nodemailer.createTransport({
  service: 'gmail',
  auth: { user, pass },
});

const mail = officerTo
  ? {
      from: `"Custody Note — sample script" <${user}>`,
      to: officerTo,
      bcc: sampleTo,
      subject,
      text:
        text +
        `\n\n---\n[TEST] BCC copy to ${sampleTo}. Officer To: ${officerTo}`,
    }
  : {
      from: `"Custody Note — sample script" <${user}>`,
      to: sampleTo,
      subject,
      text:
        text +
        '\n\n---\n[TEST] Sent to your inbox only (OFFICER_EMAIL not set). Set OFFICER_EMAIL to address a real officer (still tagged as TEST).',
    };

try {
  const info = await transporter.sendMail(mail);
  console.log('[send-officer-sample-email] Sent:', info.messageId);
  console.log(
    officerTo ? `To officer ${officerTo}, BCC ${sampleTo}` : `To inbox ${sampleTo}`
  );
} catch (e) {
  console.error('[send-officer-sample-email] Failed:', e.message || e);
  process.exit(1);
}
