import type { Logger, MailMessage, Mailer } from '../server/adapters/types';

/**
 * Transactional e-mail through Resend (https://resend.com). The sender domain must be verified
 * in Resend (SPF + DKIM records), otherwise messages are rejected or land in spam.
 */
export function createResendMailer(cfg: { apiKey: string; from: string; replyTo: string | null }, log: Logger, fetchImpl: typeof fetch = fetch): Mailer {
  return {
    kind: 'resend',
    async send(msg: MailMessage) {
      const res = await fetchImpl('https://api.resend.com/emails', {
        method: 'POST',
        // Never let a slow mail provider hold up a checkout.
        signal: AbortSignal.timeout(10_000),
        headers: { Authorization: `Bearer ${cfg.apiKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          from: cfg.from,
          to: [msg.to],
          subject: msg.subject,
          html: msg.html,
          text: msg.text,
          ...(cfg.replyTo ? { reply_to: cfg.replyTo } : {}),
        }),
      });
      if (!res.ok) {
        const body = (await res.text()).slice(0, 300);
        log.error('E-post kunne ikke sendes', { subject: msg.subject, status: res.status, body });
        throw new Error(`Resend ${res.status}`);
      }
    },
  };
}
