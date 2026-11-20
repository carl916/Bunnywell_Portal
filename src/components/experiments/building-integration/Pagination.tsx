import s from '../sales-workspace/Workspace.module.css';

export function Pagination({total,page,pageSize=20,noun,onPage}:{total:number;page:number;pageSize?:number;noun:string;onPage:(page:number)=>void}){
 const pages=Math.max(1,Math.ceil(total/pageSize)),current=Math.max(1,Math.min(page,pages));
 const summary=total===0?`No ${noun} match these filters.`:pages===1?`Showing all ${total} ${noun}`:`Showing ${(current-1)*pageSize+1}–${Math.min(current*pageSize,total)} of ${total} ${noun}`;
 return <nav className={s.pagination} aria-label={`${noun} pagination`}><span role="status">{summary}</span>{pages>1&&<><button type="button" className={s.button} disabled={current===1} onClick={()=>onPage(current-1)}>Previous</button><button type="button" className={s.button} disabled={current===pages} onClick={()=>onPage(current+1)}>Next</button></>}</nav>;
}
