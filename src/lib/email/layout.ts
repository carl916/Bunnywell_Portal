// Table layout, Arial typography and colours follow the existing snag digest.
export function escapeHtml(value: string) {
  return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#039;");
}

export const emailParagraph = (text: string) => `<p style="margin:0 0 18px;font-size:15px;line-height:1.6;">${escapeHtml(text).replaceAll("\n", "<br>")}</p>`;

export function emailSection(title: string, content: string) {
  return `<h2 style="margin:28px 0 12px;color:#0f3d2e;font-size:18px;line-height:1.3;">${escapeHtml(title)}</h2>${content}`;
}

export function emailDetails(rows: readonly (readonly [string, string])[]) {
  return `<table width="100%" cellpadding="0" cellspacing="0" style="width:100%;border-collapse:collapse;table-layout:fixed;">${rows.map(([label, value]) => `<tr><th scope="row" width="35%" align="left" valign="top" style="padding:10px 12px 10px 0;border-bottom:1px solid #edf0ec;color:#637067;font-size:13px;font-weight:400;line-height:1.5;">${escapeHtml(label)}</th><td valign="top" style="padding:10px 0;border-bottom:1px solid #edf0ec;font-size:14px;line-height:1.5;word-wrap:break-word;overflow-wrap:anywhere;">${escapeHtml(value).replaceAll("\n", "<br>")}</td></tr>`).join("")}</table>`;
}

export function emailCallout(title: string, text: string) {
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-top:26px;border-collapse:collapse;background:#fff8e7;border-left:3px solid #d49a2d;"><tr><td style="padding:18px;"><p style="margin:0 0 8px;color:#0f3d2e;font-size:15px;font-weight:700;line-height:1.5;">${escapeHtml(title)}</p><p style="margin:0;font-size:14px;line-height:1.6;">${escapeHtml(text)}</p></td></tr></table>`;
}

export function emailPortalButton(url: string) {
  const href = escapeHtml(url);
  return `<table role="presentation" cellpadding="0" cellspacing="0" style="margin:24px 0 10px;border-collapse:separate;"><tr><td align="center" bgcolor="#0f3d2e" style="background:#0f3d2e;border-radius:6px;mso-padding-alt:14px 20px;"><a href="${href}" target="_blank" style="display:inline-block;padding:14px 20px;color:#ffffff;font-family:Arial,Helvetica,sans-serif;font-size:14px;line-height:1.4;font-weight:700;text-decoration:none;border:1px solid #0f3d2e;border-radius:6px;mso-padding-alt:0;">View sale file in Bunnywell Portal</a></td></tr></table><p style="margin:0 0 24px;font-size:12px;line-height:1.6;color:#637067;">Or <a href="${href}" target="_blank" style="color:#0f3d2e;text-decoration:underline;">open the sale file in your browser</a>.</p>`;
}

export function emailShell({ title, subtitle, content, approval }: { title: string; subtitle: string; content: string; approval: string }) {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(title)}</title></head>
<body style="margin:0;padding:0;background:#f6f1e7;font-family:Arial,Helvetica,sans-serif;color:#1f2a24;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="width:100%;border-collapse:collapse;background:#f6f1e7;"><tr><td align="center" style="padding:28px 12px;">
<!--[if mso]><table role="presentation" width="640" align="center" cellpadding="0" cellspacing="0"><tr><td><![endif]-->
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="width:100%;max-width:640px;border-collapse:collapse;">
<tr><td style="padding:0 12px 22px;"><p style="margin:0;color:#d49a2d;font-size:13px;letter-spacing:4px;font-weight:700;">BUNNYWELL</p><p style="margin:4px 0 0;color:#0f3d2e;font-size:27px;font-weight:700;">Portal</p></td></tr>
<tr><td style="padding:28px 24px;border:1px solid #e2ded3;background:#ffffff;"><h1 style="margin:0 0 10px;color:#0f3d2e;font-size:26px;line-height:1.25;">${escapeHtml(title)}</h1><p style="margin:0 0 24px;padding:0 0 20px;border-bottom:1px solid #e2ded3;color:#637067;font-size:16px;line-height:1.5;font-weight:700;">${escapeHtml(subtitle)}</p>${content}<p style="margin:26px 0 0;padding-top:20px;border-top:1px solid #e2ded3;font-size:13px;line-height:1.6;color:#637067;">${escapeHtml(approval)}</p></td></tr>
</table><!--[if mso]></td></tr></table><![endif]--></td></tr></table></body></html>`;
}
