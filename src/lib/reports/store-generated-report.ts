import type { SupabaseClient } from '@supabase/supabase-js';

type ReportLocation = {
  buildingId: string; locationType: 'unit' | 'communal'; unitId: string | null;
  communalAreaId: string | null; locationLabel: string; includePhotos: boolean;
  includeClosedSnags: boolean; snagIds: string[]; filename: string;
};

export async function storeGeneratedReport(client: SupabaseClient, pdf: Blob, location: ReportLocation, request: typeof fetch = fetch) {
  const { data } = await client.auth.getSession();
  if (!data.session?.access_token) throw new Error('Sign in again to save the report in the portal.');
  const post = async (body: Record<string, unknown>) => {
    const response = await request('/api/snag-reports/send', { method: 'POST', headers: {
      Authorization: `Bearer ${data.session!.access_token}`, 'Content-Type': 'application/json',
    }, body: JSON.stringify(body) });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || 'The report could not be stored.');
    return result;
  };
  const prepared = await post({ action: 'prepare_upload', buildingId: location.buildingId, filename: location.filename });
  const uploaded = await client.storage.from('snag-reports').uploadToSignedUrl(prepared.filePath, prepared.token, pdf, { contentType: 'application/pdf', upsert: false });
  if (uploaded.error) throw uploaded.error;
  return post({ ...location, action: 'store', filePath: prepared.filePath });
}
