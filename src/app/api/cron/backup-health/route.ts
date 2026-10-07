import { checkWorkbookBackup, isBackupCheckHour, londonDay, sendBackupAlert } from '@/lib/backups/health';

export const dynamic = 'force-dynamic';
export const maxDuration = 120;

export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret || request.headers.get('authorization') !== `Bearer ${secret}`) return Response.json({ error: 'Unauthorised.' }, { status: 401 });
  const now = new Date();
  // Two UTC schedules cover GMT and BST; only the 07:00 London run does work.
  if (!isBackupCheckHour(now)) return Response.json({ skipped: true });
  let result;
  try { result = await checkWorkbookBackup(now); }
  catch (error) { result = { healthy: false, day: londonDay(now), reason: error instanceof Error ? error.message : 'Backup status could not be checked.', runUrl: 'https://github.com/carl916/Bunnywell_Portal/actions/workflows/supabase-backups.yml' }; }
  if (result.healthy) return Response.json({ healthy: true, day: result.day });
  try { await sendBackupAlert(result.day, result.reason, result.runUrl); }
  catch (error) { console.error(error instanceof Error ? error.message : 'Backup alert failed.'); return Response.json({ healthy: false, alertSent: false }, { status: 503 }); }
  return Response.json({ healthy: false, alertSent: true, day: result.day });
}
