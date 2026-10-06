-- Sale discussions use the existing transaction identity; never a unit-only key.
-- No email delivery is installed by this migration.
alter table public.unit_sale_attempts add column comment_sequence bigint not null default 0;

create table public.sale_participants (
  sale_attempt_id uuid not null references public.unit_sale_attempts(id),
  user_id uuid not null references public.profiles(id),
  assigned_by uuid references public.profiles(id),
  assigned_at timestamptz not null default now(),
  revoked_at timestamptz,
  primary key (sale_attempt_id, user_id)
);
create index sale_participants_user_idx on public.sale_participants(user_id, sale_attempt_id) where revoked_at is null;

create table public.sale_comments (
  id uuid primary key default gen_random_uuid(),
  sale_attempt_id uuid not null references public.unit_sale_attempts(id),
  sequence bigint not null,
  author_id uuid not null references public.profiles(id),
  author_name text not null,
  author_role text,
  author_organisation text,
  body text not null check (body ~ '[^[:space:]]' and length(body) <= 5000),
  stage text check (stage in ('reservation','exchange','completion','handover')),
  parent_id uuid,
  mention_ids uuid[] not null default '{}',
  client_id uuid not null,
  created_at timestamptz not null default clock_timestamp(),
  edited_at timestamptz,
  version integer not null default 1,
  unique (sale_attempt_id, sequence),
  unique (sale_attempt_id, id),
  unique (sale_attempt_id, author_id, client_id),
  foreign key (sale_attempt_id, parent_id) references public.sale_comments(sale_attempt_id, id)
);
create table public.sale_comment_revisions (
  sale_attempt_id uuid not null,
  comment_id uuid not null,
  version integer not null,
  body text not null,
  mention_ids uuid[] not null,
  recorded_at timestamptz not null,
  replaced_at timestamptz not null default clock_timestamp(),
  primary key (comment_id, version),
  foreign key (sale_attempt_id, comment_id) references public.sale_comments(sale_attempt_id, id)
);
-- Receipts acknowledge only messages actually presented, including holes in a
-- paginated feed. A high-water mark alone would incorrectly read those holes.
create table public.sale_comment_receipts (
  sale_attempt_id uuid not null,
  comment_id uuid not null,
  user_id uuid not null references public.profiles(id),
  read_at timestamptz not null default now(),
  primary key (user_id, comment_id),
  foreign key (sale_attempt_id, comment_id) references public.sale_comments(sale_attempt_id, id)
);
create table public.sale_comment_read_state (
  sale_attempt_id uuid not null references public.unit_sale_attempts(id),
  user_id uuid not null references public.profiles(id),
  last_presented_sequence bigint not null,
  primary key (sale_attempt_id, user_id)
);
create table public.sale_mention_notifications (
  id uuid primary key default gen_random_uuid(),
  sale_attempt_id uuid not null,
  comment_id uuid not null,
  recipient_id uuid not null references public.profiles(id),
  created_at timestamptz not null default now(),
  seen_at timestamptz,
  unique (comment_id, recipient_id),
  foreign key (sale_attempt_id, comment_id) references public.sale_comments(sale_attempt_id, id)
);
create index sale_mentions_recipient_idx on public.sale_mention_notifications(recipient_id, created_at desc);

-- These private helpers accept explicit identities only for use inside trusted
-- functions. The public wrapper always takes its identity from auth.uid().
create function public.sale_discussion_candidate(p_sale uuid, p_user uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.unit_sale_attempts a join public.profiles p on p.id=p_user
    where a.id=p_sale and p.active is true and (
      p.role in ('admin','developer') or (p.role in ('sales_agent','conveyancer') and (
        exists (select 1 from public.user_building_access b where b.user_id=p.id and b.building_id=a.building_id)
        or exists (select 1 from public.building_organisations b where b.building_id=a.building_id
          and b.organisation_id=p.organisation_id and b.role_on_project=p.role::text and b.active is true)
      ))
    )
  )
$$;
create function public.sale_discussion_access(p_sale uuid, p_user uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select public.sale_discussion_candidate(p_sale,p_user) and (
    exists (select 1 from public.profiles where id=p_user and role in ('admin','developer'))
    or exists (select 1 from public.sale_participants where sale_attempt_id=p_sale and user_id=p_user and revoked_at is null)
  )
$$;
create function public.can_discuss_sale(p_sale uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select public.sale_discussion_access(p_sale,auth.uid())
$$;
create function public.assert_sale_discussion(p_sale uuid) returns void
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.sale_discussion_access(p_sale,auth.uid()) then
    raise exception 'You are not assigned to this sale or your access has ended.' using errcode='42501';
  end if;
end $$;

-- Only recorded individual actors are bootstrapped, never everyone in an org.
insert into public.sale_participants(sale_attempt_id,user_id)
select distinct a.id, p.id from public.unit_sale_attempts a join public.profiles p
  on p.id in (a.created_by_user_id,a.reservation_submitted_by_user_id)
where p.role in ('sales_agent','conveyancer') and public.sale_discussion_candidate(a.id,p.id);
create function public.assign_sale_creator() returns trigger language plpgsql security definer set search_path=public as $$
begin
  if new.created_by_user_id is not null and public.sale_discussion_candidate(new.id,new.created_by_user_id) then
    insert into public.sale_participants(sale_attempt_id,user_id,assigned_by)
    values(new.id,new.created_by_user_id,new.created_by_user_id) on conflict do nothing;
  end if;
  return new;
end $$;
create trigger sale_discussion_creator after insert on public.unit_sale_attempts for each row execute function public.assign_sale_creator();

create function public.assign_sale_submitter() returns trigger language plpgsql security definer set search_path=public as $$
begin
  if new.reservation_submitted_by_user_id is distinct from old.reservation_submitted_by_user_id
    and new.reservation_submitted_by_user_id is not null and public.sale_discussion_candidate(new.id,new.reservation_submitted_by_user_id) then
    insert into public.sale_participants(sale_attempt_id,user_id,assigned_by)
      values(new.id,new.reservation_submitted_by_user_id,new.reservation_submitted_by_user_id) on conflict do nothing;
  end if;
  return new;
end $$;
create trigger sale_discussion_submitter after update of reservation_submitted_by_user_id on public.unit_sale_attempts for each row execute function public.assign_sale_submitter();

create function public.sale_discussion_start(p_unit uuid) returns uuid
language plpgsql security definer set search_path=public as $$
declare a uuid; u public.units%rowtype; next_number integer;
begin
  if not exists(select 1 from public.profiles where id=auth.uid() and active is true and role in ('admin','developer','sales_agent')) then
    raise exception 'You cannot start a sale discussion.' using errcode='42501';
  end if;
  select * into u from public.units where id=p_unit for update;
  if u.id is null or not public.can_access_sales_building(u.building_id) then raise exception 'Unit access denied.' using errcode='42501'; end if;
  select id into a from public.unit_sale_attempts where unit_id=p_unit and is_active;
  if a is not null then perform public.assert_sale_discussion(a); return a; end if;
  if u.sale_status <> 'for_sale' then raise exception 'This unit is not available for a new sale.'; end if;
  select coalesce(max(attempt_number),0)+1 into next_number from public.unit_sale_attempts where unit_id=p_unit;
  insert into public.unit_sale_attempts(building_id,unit_id,attempt_number,workflow_status,is_active,created_by_user_id,updated_by_user_id,is_system_baseline)
    values(u.building_id,u.id,next_number,'draft',true,auth.uid(),auth.uid(),false) returning id into a;
  return a;
end $$;

create function public.sale_discussion_people(p_sale uuid, p_candidates boolean default false) returns jsonb
language plpgsql stable security definer set search_path=public as $$
declare result jsonb;
begin
  perform public.assert_sale_discussion(p_sale);
  if p_candidates and not public.is_sales_internal_user() then raise exception 'Only developers can manage assignments.' using errcode='42501'; end if;
  select coalesce(jsonb_agg(jsonb_build_object('id',p.id,'name',coalesce(nullif(p.full_name,''),nullif(p.name,''),'Sale participant'),
    'role',p.role,'organisation',o.name,'assigned',public.sale_discussion_access(p_sale,p.id)) order by p.full_name,p.id),'[]') into result
  from public.profiles p left join public.organisations o on o.id=p.organisation_id
  where case when p_candidates then public.sale_discussion_candidate(p_sale,p.id) else public.sale_discussion_access(p_sale,p.id) end;
  return result;
end $$;
create function public.sale_discussion_assign(p_sale uuid,p_user uuid,p_assigned boolean) returns void
language plpgsql security definer set search_path=public as $$
begin
  perform 1 from public.unit_sale_attempts where id=p_sale for update;
  perform public.assert_sale_discussion(p_sale);
  if not public.is_sales_internal_user() then raise exception 'Only developers can manage assignments.' using errcode='42501'; end if;
  if p_assigned and not public.sale_discussion_candidate(p_sale,p_user) then raise exception 'This person is not eligible for this sale.'; end if;
  if exists(select 1 from public.profiles where id=p_user and role in ('admin','developer')) then raise exception 'Internal access is managed by existing portal permissions.'; end if;
  insert into public.sale_participants(sale_attempt_id,user_id,assigned_by,revoked_at)
    values(p_sale,p_user,auth.uid(),case when p_assigned then null else now() end)
    on conflict(sale_attempt_id,user_id) do update set assigned_by=auth.uid(),assigned_at=now(),revoked_at=excluded.revoked_at;
  if not p_assigned then delete from public.sale_mention_notifications where sale_attempt_id=p_sale and recipient_id=p_user; end if;
  insert into public.audit_events(event_type,entity_type,entity_id,summary,metadata,created_by_user_id)
    values('sale_participant_changed','sale_attempt',p_sale,'Sale discussion assignment updated.',jsonb_build_object('user_id',p_user,'assigned',p_assigned),auth.uid());
end $$;

create function public.sale_comment_write(p_sale uuid,p_body text,p_client uuid,p_parent uuid default null,p_stage text default null,
  p_mentions uuid[] default '{}',p_comment uuid default null,p_version integer default null) returns uuid
language plpgsql security definer set search_path=public as $$
declare old_comment public.sale_comments%rowtype; new_id uuid; n bigint; actor public.profiles%rowtype; org text;
begin
  -- Serialise per transaction so sequence order also follows commit order.
  perform 1 from public.unit_sale_attempts where id=p_sale for update;
  perform public.assert_sale_discussion(p_sale);
  if p_body is null or p_body !~ '[^[:space:]]' or length(p_body)>5000 or p_client is null then raise exception 'Write an update of 1–5,000 characters.'; end if;
  if p_stage is not null and p_stage not in ('reservation','exchange','completion','handover') then raise exception 'Invalid stage.'; end if;
  if cardinality(p_mentions)>25 or exists(select 1 from unnest(p_mentions) x where not public.sale_discussion_access(p_sale,x)) then
    raise exception 'A mentioned person no longer has access. Remove the mention and retry.' using errcode='42501';
  end if;
  if p_parent is not null and not exists(select 1 from public.sale_comments where id=p_parent and sale_attempt_id=p_sale) then raise exception 'Reply must refer to a comment on this sale.'; end if;
  select * into actor from public.profiles where id=auth.uid();
  select name into org from public.organisations where id=actor.organisation_id;
  if p_comment is null then
    select * into old_comment from public.sale_comments where sale_attempt_id=p_sale and author_id=auth.uid() and client_id=p_client;
    if old_comment.id is not null then
      if old_comment.body is distinct from p_body or old_comment.mention_ids is distinct from coalesce(p_mentions,'{}')
        or old_comment.parent_id is distinct from p_parent or old_comment.stage is distinct from p_stage then
        raise exception 'The earlier update was already sent. Your revised text can be sent as a new update.';
      end if;
      return old_comment.id;
    end if;
    update public.unit_sale_attempts set comment_sequence=comment_sequence+1,is_system_baseline=false where id=p_sale returning comment_sequence into n;
    insert into public.sale_comments(sale_attempt_id,sequence,author_id,author_name,author_role,author_organisation,body,stage,parent_id,mention_ids,client_id)
      values(p_sale,n,auth.uid(),coalesce(nullif(actor.full_name,''),nullif(actor.name,''),'Sale participant'),actor.role,org,p_body,p_stage,p_parent,coalesce(p_mentions,'{}'),p_client) returning id into new_id;
  else
    select * into old_comment from public.sale_comments where id=p_comment and sale_attempt_id=p_sale for update;
    if old_comment.id is null or old_comment.author_id<>auth.uid() then raise exception 'Only the author can edit this comment.' using errcode='42501'; end if;
    if old_comment.body=p_body and old_comment.mention_ids=coalesce(p_mentions,'{}') then return p_comment; end if;
    if p_version is distinct from old_comment.version then raise exception 'This comment changed on another device. Reload its history before editing.'; end if;
    insert into public.sale_comment_revisions(sale_attempt_id,comment_id,version,body,mention_ids,recorded_at)
      values(p_sale,p_comment,old_comment.version,old_comment.body,old_comment.mention_ids,coalesce(old_comment.edited_at,old_comment.created_at));
    update public.sale_comments set body=p_body,mention_ids=coalesce(p_mentions,'{}'),edited_at=clock_timestamp(),version=version+1 where id=p_comment;
    new_id:=p_comment;
  end if;
  insert into public.sale_mention_notifications(sale_attempt_id,comment_id,recipient_id)
    select p_sale,new_id,x from unnest(coalesce(p_mentions,'{}')) x where x<>auth.uid() on conflict(comment_id,recipient_id) do nothing;
  return new_id;
end $$;

create function public.sale_comment_page(p_sale uuid,p_before bigint default null,p_after bigint default null,p_target uuid default null,p_unit uuid default null) returns jsonb
language plpgsql stable security definer set search_path=public as $$
declare start_at bigint; result jsonb; low_seq bigint; high_seq bigint;
begin
  perform public.assert_sale_discussion(p_sale);
  if p_unit is not null and not exists(select 1 from public.unit_sale_attempts where id=p_sale and unit_id=p_unit) then raise exception 'This conversation does not belong to the selected unit.'; end if;
  if p_before is not null and p_after is not null then raise exception 'Choose one cursor.'; end if;
  if p_target is not null then
    select sequence into start_at from public.sale_comments where id=p_target and sale_attempt_id=p_sale;
    if start_at is null then raise exception 'Comment unavailable on this sale.'; end if;
    start_at:=greatest(1,start_at-5);
  elsif p_before is null and p_after is null then
    select min(c.sequence) into start_at from public.sale_comments c where c.sale_attempt_id=p_sale and c.author_id<>auth.uid()
      and not exists(select 1 from public.sale_comment_receipts r where r.comment_id=c.id and r.user_id=auth.uid());
    if start_at is not null then start_at:=greatest(1,start_at-5); end if;
  end if;
  with page as (
    select c.* from public.sale_comments c where c.sale_attempt_id=p_sale
      and (p_before is null or c.sequence<p_before) and (p_after is null or c.sequence>p_after)
      and (start_at is null or c.sequence>=start_at)
    order by case when p_after is not null or start_at is not null then c.sequence end asc, c.sequence desc limit 50
  ) select coalesce(jsonb_agg(to_jsonb(c)||jsonb_build_object('unread',c.author_id<>auth.uid() and not exists(
      select 1 from public.sale_comment_receipts r where r.comment_id=c.id and r.user_id=auth.uid())) order by c.sequence),'[]'),min(c.sequence),max(c.sequence)
    into result,low_seq,high_seq from page c;
  return jsonb_build_object('comments',result,'hasBefore',exists(select 1 from public.sale_comments where sale_attempt_id=p_sale and sequence<low_seq),
    'hasAfter',exists(select 1 from public.sale_comments where sale_attempt_id=p_sale and sequence>high_seq));
end $$;
create function public.sale_comment_history(p_sale uuid,p_comment uuid) returns jsonb
language plpgsql stable security definer set search_path=public as $$
declare result jsonb;
begin
  perform public.assert_sale_discussion(p_sale);
  if not exists(select 1 from public.sale_comments where sale_attempt_id=p_sale and id=p_comment) then raise exception 'Comment unavailable on this sale.'; end if;
  select coalesce(jsonb_agg(to_jsonb(r) order by version desc),'[]') into result from public.sale_comment_revisions r where sale_attempt_id=p_sale and comment_id=p_comment;
  return result;
end $$;
create function public.sale_comment_read(p_sale uuid,p_comments uuid[]) returns void
language plpgsql security definer set search_path=public as $$
declare n bigint;
begin
  perform public.assert_sale_discussion(p_sale);
  if cardinality(p_comments)>100 then raise exception 'Too many read receipts.'; end if;
  if exists(select 1 from unnest(p_comments) x where not exists(select 1 from public.sale_comments where id=x and sale_attempt_id=p_sale)) then raise exception 'Invalid comment receipt.'; end if;
  insert into public.sale_comment_receipts(sale_attempt_id,comment_id,user_id) select p_sale,x,auth.uid() from unnest(p_comments) x on conflict do nothing;
  select max(sequence) into n from public.sale_comments where sale_attempt_id=p_sale and id=any(p_comments);
  if n is not null then
    insert into public.sale_comment_read_state values(p_sale,auth.uid(),n) on conflict(sale_attempt_id,user_id)
      do update set last_presented_sequence=greatest(sale_comment_read_state.last_presented_sequence,excluded.last_presented_sequence);
  end if;
  update public.sale_mention_notifications set seen_at=coalesce(seen_at,now()) where recipient_id=auth.uid() and sale_attempt_id=p_sale and comment_id=any(p_comments);
end $$;
create function public.sale_comment_unread(p_sales uuid[]) returns jsonb
language plpgsql stable security definer set search_path=public as $$
declare result jsonb;
begin
  if cardinality(p_sales)>500 then raise exception 'Too many sales.'; end if;
  select coalesce(jsonb_object_agg(s.id,(select count(*) from public.sale_comments c where c.sale_attempt_id=s.id and c.author_id<>auth.uid()
    and not exists(select 1 from public.sale_comment_receipts r where r.comment_id=c.id and r.user_id=auth.uid()))),'{}') into result
    from (select distinct unnest(p_sales) id) s where public.sale_discussion_access(s.id,auth.uid());
  return result;
end $$;
create function public.sale_mentions_inbox() returns jsonb
language sql stable security definer set search_path=public as $$
  select coalesce(jsonb_agg(to_jsonb(n) order by n.created_at desc),'[]') from (
    select m.id,m.comment_id,m.sale_attempt_id,m.created_at,a.unit_id,a.building_id,u.unit_number,b.name building_name,c.author_name
    from public.sale_mention_notifications m join public.sale_comments c on c.id=m.comment_id
    join public.unit_sale_attempts a on a.id=m.sale_attempt_id join public.units u on u.id=a.unit_id join public.buildings b on b.id=a.building_id
    where m.recipient_id=auth.uid() and m.seen_at is null and public.sale_discussion_access(m.sale_attempt_id,auth.uid())
      and auth.uid()=any(c.mention_ids)
    order by m.created_at desc,m.id desc limit 50
  ) n
$$;

-- Prevent a conversation being reassigned by editing a rejected reservation's
-- buyer identity. Returning the unit to For sale already creates a new attempt.
create function public.protect_discussion_buyer() returns trigger language plpgsql security definer set search_path=public as $$
begin
  if (nullif(trim(old.buyer_name),'') is not null or nullif(trim(old.buyer_person_name),'') is not null or nullif(trim(old.buyer_company_name),'') is not null)
    and (old.buyer_name is distinct from new.buyer_name or old.buyer_person_name is distinct from new.buyer_person_name or old.buyer_company_name is distinct from new.buyer_company_name)
    and exists(select 1 from public.sale_comments where sale_attempt_id=old.id) then
    raise exception 'This sale has a conversation. For a replacement buyer, return the unit to For sale and start a new transaction.';
  end if;
  return new;
end $$;
create trigger sale_discussion_buyer before update on public.unit_sale_attempts for each row execute function public.protect_discussion_buyer();

-- New content must stop draft cleanup, without changing the sale lifecycle.
alter function public.sale_attempt_has_meaningful_activity(uuid) rename to sale_attempt_has_meaningful_activity_before_discussions;
create function public.sale_attempt_has_meaningful_activity(p_sale_attempt_id uuid) returns boolean
language sql stable security definer set search_path=public as $$
  select exists(select 1 from public.sale_comments where sale_attempt_id=p_sale_attempt_id)
    or public.sale_attempt_has_meaningful_activity_before_discussions(p_sale_attempt_id)
$$;

-- All writes go through the authenticated functions, including for developers.
do $$ declare t text; begin
  foreach t in array array['sale_participants','sale_comments','sale_comment_revisions','sale_comment_receipts','sale_comment_read_state','sale_mention_notifications'] loop
    execute format('alter table public.%I enable row level security',t);
    execute format('revoke all on public.%I from anon, authenticated',t);
    execute format('grant select on public.%I to authenticated',t);
    execute format('grant all on public.%I to service_role',t);
  end loop;
end $$;
create policy discussion_participants_read on public.sale_participants for select to authenticated using(public.can_discuss_sale(sale_attempt_id));
create policy discussion_comments_read on public.sale_comments for select to authenticated using(public.can_discuss_sale(sale_attempt_id));
create policy discussion_revisions_read on public.sale_comment_revisions for select to authenticated using(public.can_discuss_sale(sale_attempt_id));
create policy discussion_receipts_read on public.sale_comment_receipts for select to authenticated using(user_id=auth.uid() and public.can_discuss_sale(sale_attempt_id));
create policy discussion_read_state_read on public.sale_comment_read_state for select to authenticated using(user_id=auth.uid() and public.can_discuss_sale(sale_attempt_id));
create policy discussion_mentions_read on public.sale_mention_notifications for select to authenticated using(recipient_id=auth.uid() and public.can_discuss_sale(sale_attempt_id));

do $$ declare f record; begin
  for f in select oid::regprocedure signature,proname from pg_proc where pronamespace='public'::regnamespace and proname in (
    'sale_discussion_candidate','sale_discussion_access','can_discuss_sale','assert_sale_discussion','assign_sale_creator','assign_sale_submitter',
    'sale_discussion_start','sale_discussion_people','sale_discussion_assign','sale_comment_write','sale_comment_page','sale_comment_history',
    'sale_comment_read','sale_comment_unread','sale_mentions_inbox','protect_discussion_buyer','sale_attempt_has_meaningful_activity','sale_attempt_has_meaningful_activity_before_discussions') loop
    execute format('revoke all on function %s from public,anon,authenticated',f.signature);
    execute format('grant execute on function %s to service_role',f.signature);
    if f.proname in ('can_discuss_sale','sale_discussion_start','sale_discussion_people','sale_discussion_assign','sale_comment_write',
      'sale_comment_page','sale_comment_history','sale_comment_read','sale_comment_unread','sale_mentions_inbox') then
      execute format('grant execute on function %s to authenticated',f.signature);
    end if;
  end loop;
end $$;
