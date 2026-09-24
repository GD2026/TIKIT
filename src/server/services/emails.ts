/** Minimal, robust transactional email layout (inline styles, escaped content). */

export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export interface EmailContent {
  appName: string;
  heading: string;
  paragraphs: string[];
  cta?: { label: string; url: string };
  footnote?: string;
}

export function renderEmail(content: EmailContent): { html: string; text: string } {
  const paragraphs = content.paragraphs
    .map((p) => `<p style="margin:0 0 14px;font-size:16px;line-height:1.5;color:#1c1c1e">${escapeHtml(p).replace(/\n/g, '<br>')}</p>`)
    .join('');
  const cta = content.cta
    ? `<p style="margin:24px 0"><a href="${escapeHtml(content.cta.url)}" style="display:inline-block;background:#3B4CF2;color:#ffffff;text-decoration:none;font-weight:600;font-size:16px;padding:14px 22px;border-radius:14px">${escapeHtml(content.cta.label)}</a></p>`
    : '';
  const footnote = content.footnote
    ? `<p style="margin:16px 0 0;font-size:13px;line-height:1.45;color:#6c6c71">${escapeHtml(content.footnote)}</p>`
    : '';
  const html = `<!doctype html><html lang="nb"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>${escapeHtml(content.heading)}</title></head>
<body style="margin:0;background:#f2f2f7;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f2f2f7;padding:24px 12px"><tr><td align="center">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;background:#ffffff;border-radius:20px;padding:28px">
<tr><td>
<p style="margin:0 0 20px;font-size:15px;font-weight:800;letter-spacing:0.12em;color:#3B4CF2">${escapeHtml(content.appName)}</p>
<h1 style="margin:0 0 16px;font-size:24px;line-height:1.25;color:#000000">${escapeHtml(content.heading)}</h1>
${paragraphs}${cta}${footnote}
</td></tr></table>
<p style="margin:16px 0 0;font-size:12px;color:#6c6c71">Du får denne e-posten fordi du har en konto hos ${escapeHtml(content.appName)}.</p>
</td></tr></table></body></html>`;
  const text = [content.heading, '', ...content.paragraphs, content.cta ? `\n${content.cta.label}: ${content.cta.url}` : '', content.footnote ?? '']
    .filter((l) => l !== undefined)
    .join('\n');
  return { html, text };
}
