import { deriveDashboard } from './model';
import { datesToReview, deriveInternalOverview } from './overview';
import type { DashboardInput, DashboardSnapshot } from './types';

/** Summaries always use the complete authorised worklist. Only the internal
 * transport is reduced; operational/external roles keep every detailed item.
 */
export function dashboardResponse(input: DashboardInput): DashboardSnapshot {
  const snapshot = deriveDashboard(input);
  snapshot.overview = deriveInternalOverview(input, snapshot);
  if (snapshot.overview) snapshot.items = datesToReview(snapshot);
  return snapshot;
}
