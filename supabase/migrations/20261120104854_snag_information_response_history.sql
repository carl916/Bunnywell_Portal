-- Keep an information response on its status-change event only. The attachment
-- retains its own audit event and the same transaction/submission receipt.
do $migration$
declare definition text;
 old_fragment text := 'values(target,''photo_added'',coalesce(note,''Test evidence added.''),actor.id);';
 new_fragment text := 'values(target,''photo_added'',case when p_action=''answer_snag_info'' then ''Evidence attached to information response.'' else coalesce(note,''Test evidence added.'') end,actor.id);';
begin
 select pg_get_functiondef('public.workspace_snag_operation(uuid,uuid,uuid,text,jsonb)'::regprocedure) into definition;
 if position(old_fragment in definition)=0 then raise exception 'Unexpected snag operation baseline; review before applying.'; end if;
 execute replace(definition,old_fragment,new_fragment);
end $migration$;
