begin;
-- Legal workflow comments already hold the sale row lock but may leave the
-- ordinary-comment counter behind. Allocate beyond both without rewriting history.
do $$
declare definition text; old text:='comment_sequence=comment_sequence+1';
begin
 select pg_get_functiondef('public.sale_comment_write(uuid,text,uuid,uuid,text,uuid[],uuid,integer)'::regprocedure) into definition;
 if (length(definition)-length(replace(definition,old,'')))/length(old)<>1 then raise exception 'Unexpected comment allocator definition.'; end if;
 execute replace(definition,old,'comment_sequence=greatest(comment_sequence,coalesce((select max(c.sequence) from public.sale_comments c where c.sale_attempt_id=p_sale),0))+1');
end $$;
commit;
