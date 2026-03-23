'use strict';

/**
 * Builds the Outlook Web (OWA) compose deeplink. Single source of truth for URL shape + encoding.
 */
function buildOutlookWebComposeUrl({ to, cc, bcc, subject, body }) {
  const encode = (v) => encodeURIComponent(v || '');
  return (
    'https://outlook.office.com/mail/deeplink/compose' +
    '?to=' + encode(to) +
    '&cc=' + encode(cc) +
    '&bcc=' + encode(bcc) +
    '&subject=' + encode(subject) +
    '&body=' + encode(body)
  );
}

module.exports = { buildOutlookWebComposeUrl };
