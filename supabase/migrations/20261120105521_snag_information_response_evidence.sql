-- Information responses use the same private, scoped and idempotent upload path.
do $migration$
declare definition text;
 old_fragment text := 'p_action not in (''create_snag'',''resolve_snag'',''reject_snag'',''add_snag_media'')';
 new_fragment text := 'p_action not in (''create_snag'',''resolve_snag'',''reject_snag'',''add_snag_media'',''answer_snag_info'')';
begin
 select pg_get_functiondef('public.workspace_snag_media(uuid,uuid,uuid,text,text,text,bigint)'::regprocedure) into definition;
 if position(old_fragment in definition)=0 then raise exception 'Unexpected snag media baseline; review before applying.'; end if;
 execute replace(definition,old_fragment,new_fragment);
end $migration$;
