CREATE OR REPLACE FUNCTION public.sale_comment_write(p_sale uuid, p_body text, p_client uuid, p_parent uuid DEFAULT NULL::uuid, p_stage text DEFAULT NULL::text, p_mentions uuid[] DEFAULT '{}'::uuid[], p_comment uuid DEFAULT NULL::uuid, p_version integer DEFAULT NULL::integer)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
    update public.unit_sale_attempts set comment_sequence=greatest(comment_sequence,coalesce((select max(c.sequence) from public.sale_comments c where c.sale_attempt_id=p_sale),0))+1,is_system_baseline=false where id=p_sale returning comment_sequence into n;
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
end $function$
