export const isTelemetry = row => row.category === 'vercel-function' && row.endpoint === '/api/performance/vitals' && row.method === 'POST';
export function assessRequest(row, legalRegion = 'fra1') {
  const telemetry = isTelemetry(row);
  const unloadAbort = telemetry && row.failed && row.failure === 'net::ERR_ABORTED' && row.unloadAssociated === true;
  const collectorOutcome = telemetry ? row.status === 204 ? 'accepted' : row.status == null ? 'unknown' : 'not-accepted' : null;
  const acceptedTelemetryAbort = telemetry && row.failed && row.failure === 'net::ERR_ABORTED' && collectorOutcome === 'accepted';
  const httpError = row.status >= 400;
  const transportFailure = row.failed && !unloadAbort && !acceptedTelemetryAbort;
  const isFunction = row.category === 'vercel-function';
  const expectedRegion = row.endpoint === '/api/sales/legal' ? legalRegion : 'iad1';
  // Missing headers on an unload-aborted beacon are unknown, never a verified region.
  const regionUnknown = isFunction && row.executionRegion == null;
  const regionFailure = isFunction && (regionUnknown ? !(unloadAbort && row.status == null) : row.executionRegion !== expectedRegion);
  return { telemetry, unloadAbort, acceptedTelemetryAbort, collectorOutcome, httpError, transportFailure, regionUnknown, regionFailure,
    applicationFailure: !telemetry && (httpError || transportFailure),
    gateFailure: httpError || transportFailure || regionFailure };
}
