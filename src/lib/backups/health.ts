const repository = 'carl916/Bunnywell_Portal';
const workflow = 'supabase-backups.yml';
const workbookStep = 'Generate and publish operational workbook package';

export function londonDay(now: Date) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/London', year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
}
export function isBackupCheckHour(now: Date) {
  return new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/London', hour: '2-digit', hourCycle: 'h23' }).format(now) === '07';
}

type WorkflowRun = { id: number; html_url: string; run_started_at: string; status: string; conclusion: string | null; head_branch: string };
type Job = { steps?: { name: string; conclusion: string | null; completed_at?: string }[] };

export async function checkWorkbookBackup(now: Date, request: typeof fetch = fetch) {
  const get = async (path: string) => {
    const response = await request(`https://api.github.com/repos/${repository}/${path}`, {
      headers: { Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28' },
      cache: 'no-store', signal: AbortSignal.timeout(20000),
    });
    if (!response.ok) throw new Error(`Backup status could not be checked (GitHub HTTP ${response.status}).`);
    return response.json();
  };
  const day = londonDay(now);
  const data = await get(`actions/workflows/${workflow}/runs?per_page=30`) as { workflow_runs: WorkflowRun[] };
  const today = data.workflow_runs.filter(run => run.head_branch === 'main' && londonDay(new Date(run.run_started_at)) === day);
  for (const run of today) {
    if (run.conclusion !== 'success') continue;
    const jobs = await get(`actions/runs/${run.id}/jobs?per_page=100`) as { jobs: Job[] };
    if (jobs.jobs.some(job => job.steps?.some(step => step.name === workbookStep && step.conclusion === 'success' && step.completed_at && londonDay(new Date(step.completed_at)) === day))) {
      return { healthy: true, day, runUrl: run.html_url, reason: 'Today’s workbook package was published and verified.' };
    }
  }
  const latest = today[0];
  return { healthy: false, day, runUrl: latest?.html_url ?? `https://github.com/${repository}/actions/workflows/${workflow}`,
    reason: latest ? `No verified workbook backup is available for today. The latest run is ${latest.conclusion || latest.status}.` : 'No production backup run has started today.' };
}

export async function sendBackupAlert(day: string, reason: string, runUrl: string, request: typeof fetch = fetch) {
  const key = process.env.RESEND_API_KEY;
  if (!key) throw new Error('Backup alert email is not configured.');
  const recipient = process.env.BACKUP_ALERT_EMAIL || 'info@bunnywell.co.uk';
  const response = await request('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json', 'Idempotency-Key': `workbook-backup-alert-${day}` },
    body: JSON.stringify({
      from: process.env.DIGEST_FROM_EMAIL || 'Bunnywell Portal <no-reply@bunnywell.co.uk>', to: recipient,
      subject: `Bunnywell workbook backup needs attention — ${day}`,
      text: `${reason}\n\nThe previous successful package remains in Dropbox: Supabase Backups / bunnywell-portal-production / workbooks / Latest.zip.\n\nCheck the run and retry the backup after resolving the failure:\n${runUrl}\n\nThis check runs independently of the GitHub backup workflow at 07:00 UK time.`,
    }),
    signal: AbortSignal.timeout(20000),
  });
  if (!response.ok) throw new Error(`Backup alert delivery failed (HTTP ${response.status}).`);
}
