-- Read-only ClickHouse queries, using Supabase query_logs.
-- Project: vxkpvdtrldwwqiddoyof (staging).
-- Historical window: 2026-10-09T12:26:00Z through 2026-10-09T16:16:00Z.
-- Never omit the explicit start/end tool parameters when reusing these queries.

select source, count() as records from logs group by source order by source;

select source,
  arraySort(arrayDistinct(arrayFlatten(groupArray(mapKeys(log_attributes))))) as fields
from logs
where source in ('edge_logs','auth_logs','postgrest_logs','postgres_logs')
group by source;

select timestamp, source,
  log_attributes['request_id'] as request_id,
  log_attributes['request.path'] as path,
  log_attributes['request.cf.colo'] as colo,
  log_attributes['request.headers.cf_ray'] as cf_ray,
  log_attributes['response.origin_time'] as origin_ms,
  log_attributes['response.headers.x_envoy_upstream_service_time'] as upstream_ms,
  log_attributes['response.headers.x_envoy_attempt_count'] as attempts,
  log_attributes['response.status_code'] as status,
  log_attributes['trace_id'] as trace_id,
  log_attributes['span_id'] as span_id,
  log_attributes['duration'] as duration,
  log_attributes['path'] as auth_path
from logs
where log_attributes['request_id'] in (
  '01a120a1-85af-7077-b80b-a5217be9b013',
  '01a120b9-5f9f-7178-9928-83cf1a7ac6bb',
  '01a12171-b6d9-717b-b160-2dc858a3dfd4'
)
order by timestamp;

-- Trace/span lookup returned only the same three edge records, no internal spans.
select source, count() as matches from logs
where log_attributes['trace_id'] in (
  '01a120a185af7077b80ba5217be9b013',
  '01a120b95f9f7178992883cf1a7ac6bb',
  '01a12171b6d9717bb1602dc858a3dfd4'
) or log_attributes['span_id'] in (
  'ae755883ef8a5063','c75c0ce543bf2f55','544077344fd6725a'
)
group by source;

-- Use 2026-10-09T16:14:15Z through 2026-10-09T16:15:05Z for this join.
select e.log_attributes['request_id'] as request_id,
  e.timestamp as edge_timestamp, a.timestamp as auth_completed_second,
  e.log_attributes['response.origin_time'] as origin_ms,
  e.log_attributes['response.headers.x_envoy_upstream_service_time'] as upstream_ms,
  a.log_attributes['duration'] as auth_duration_ns,
  dateDiff('millisecond',e.timestamp,a.timestamp) as edge_to_auth_log_ms
from logs e inner join logs a
  on e.log_attributes['request_id']=a.log_attributes['request_id']
where e.source='edge_logs' and a.source='auth_logs'
  and a.log_attributes['msg']='request completed'
  and a.log_attributes['path']='/user'
order by e.timestamp limit 30;
