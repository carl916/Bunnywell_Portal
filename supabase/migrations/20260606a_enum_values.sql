-- Run this first, by itself, in Supabase SQL Editor.
-- Postgres requires enum additions to be committed before those values are used
-- later in policies, defaults, checks, or inserts.

alter type public.user_role add value if not exists 'developer';
alter type public.user_role add value if not exists 'developer_representative';
alter type public.user_role add value if not exists 'contractor';
alter type public.user_role add value if not exists 'trade';
alter type public.user_role add value if not exists 'leaseholder';
alter type public.user_role add value if not exists 'agent';
alter type public.user_role add value if not exists 'resident';

alter type public.snag_status add value if not exists 'open';
alter type public.snag_status add value if not exists 'resolved_by_contractor';
alter type public.snag_status add value if not exists 'rejected_back_to_contractor';
alter type public.snag_status add value if not exists 'closed';
alter type public.snag_status add value if not exists 'submitted';
alter type public.snag_status add value if not exists 'needs_more_info';
alter type public.snag_status add value if not exists 'rejected';
alter type public.snag_status add value if not exists 'accepted';
alter type public.snag_status add value if not exists 'assigned_to_contractor';
alter type public.snag_status add value if not exists 'in_progress';
alter type public.snag_status add value if not exists 'resolved';
