import {mergeComments,type CommentPage,type SaleActivity} from '@/lib/sales/discussion';

export type ActivityPage={items:SaleActivity[];hasMore:boolean};

// Retain explicitly loaded pages when refreshing an overlapping window. If the
// server's window has moved beyond it, keep its cursors intact: merging disjoint
// windows would leave a gap that neither pagination button could retrieve.
export function mergeCommentPage(previous:CommentPage|undefined,page:CommentPage):CommentPage{
 if(!previous?.comments.length||!page.comments.length||!page.comments.some(item=>previous.comments.some(old=>old.id===item.id)))return page;
 return {
  comments:mergeComments(previous.comments,page.comments),
  hasBefore:page.comments[0].sequence<=previous.comments[0].sequence?page.hasBefore:previous.hasBefore,
  hasAfter:page.comments.at(-1)!.sequence>=previous.comments.at(-1)!.sequence?page.hasAfter:previous.hasAfter,
 };
}

const activityOrder=(a:SaleActivity,b:SaleActivity)=>b.created_at.localeCompare(a.created_at)||b.id.localeCompare(a.id);
export function mergeActivityPage(previous:ActivityPage|undefined,page:SaleActivity[]):ActivityPage{
 const incoming=page.slice(0,50),hasMore=page.length>50;
 if(!previous?.items.length||!incoming.length||!incoming.some(item=>previous.items.some(old=>old.id===item.id)))return {items:incoming,hasMore};
 return {
  items:[...new Map([...previous.items,...incoming].map(item=>[item.id,item])).values()].sort(activityOrder),
  hasMore:activityOrder(previous.items.at(-1)!,incoming.at(-1)!)>=0?previous.hasMore:hasMore,
 };
}
