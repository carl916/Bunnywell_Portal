# Sales authority emails

Authority to Exchange and Authority to Serve Notice share the Bunnywell email shell, detail rows, payment table, portal button and approval footer. Each has equivalent HTML and plain text. Notice authority remains date-free under the current completion workflow.

The canonical production URL is `https://portal.bunnywell.co.uk`. The existing email configuration precedence is retained: `DIGEST_APP_URL`, `NEXT_PUBLIC_APP_URL`, then `NEXT_PUBLIC_SITE_URL` override that address. Set the appropriate public URL when sending from staging. Request headers never determine legal-email destinations.

Links use the existing `screen=sales`, building UUID, `salesUnitId` and sale `conversation` UUID route. The sign-in form authenticates in place and preserves this destination. Normal screen, building and sale permissions apply; no authentication token is included in an email link.

Apply `20260922c_legal_email_presentation.sql` after the completion-notice migration. It adds nullable `sale_legal_emails.html_body`, includes the stable unit UUID in new legal snapshots and stores the exact approved HTML alongside the existing text. Existing emails, audit events, delivery states and snapshots are not rewritten. Retries use saved content; historical text-only emails remain text-only. Both representations are covered by the existing signed preview and immutable-email guard.

Payment rows use the stored schedule once. Internal triggers become readable due descriptions; the existing second-deposit rule is expressed as its stored day offset after exchange. Generated payment summaries are omitted to avoid repetition; bespoke terms and payment notes are retained. Currency retains pence, and expiry times explicitly use Europe/London with BST or GMT.

Run `npm run test:sales`, `npx tsc --noEmit` and `npm run lint`. Run `node scripts/render-legal-email-previews.mjs` for fictional-data HTML, text and desktop/mobile PNG previews in `artifacts/legal-emails`. These are browser render checks, not a claim of live Gmail/Outlook client certification.
