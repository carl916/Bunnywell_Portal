"use client";
import {useState} from 'react';
import {noticeDeadline,noticeValidation,type NoticeInput,type NoticeTerms} from '@/lib/sales/notice-contract';
import s from '../sales-workspace/Workspace.module.css';
export default function NoticeDateFields({value,onChange,terms,disabled=false}:{value:NoticeInput;onChange:(value:NoticeInput)=>void;terms:NoticeTerms;disabled?:boolean}){
 const [overridden,setOverridden]=useState(Boolean(value.dueDate));
 const change=(patch:Partial<NoticeInput>)=>onChange({...value,...patch});
 const error=noticeValidation(value,terms);
 return <fieldset disabled={disabled} className={s.formSection}><legend>Contractual completion arrangements</legend>
  <label className={s.field}>Completion basis<select value={value.basis} onChange={e=>change({basis:e.target.value as NoticeInput['basis']})}><option value="on_notice">Completion on notice</option><option value="fixed_date">Fixed-date agreement</option></select></label>
  <label className={s.field}>Notice issue date<input type="date" required value={value.noticeDate} onChange={e=>change({noticeDate:e.target.value,serviceConfirmed:false})}/></label>
  {value.basis==='on_notice'&&<><p className={s.meta}>{terms.workingDays} working days after valid service, excluding weekends and England/Wales bank holidays. {terms.serviceProvision||'Check the contract for delivery method, cut-off time and deemed service.'}</p>
   <label className={s.field}>Valid service / deemed-service date<input type="date" required value={value.serviceDate} onChange={e=>change({serviceDate:e.target.value,serviceConfirmed:false,...(!overridden?{dueDate:noticeDeadline(e.target.value,terms.workingDays)}:{})})}/></label>
   <label className={s.checkboxField}><input type="checkbox" checked={value.serviceConfirmed} onChange={e=>change({serviceConfirmed:e.target.checked})}/>I have checked the service date against the contract, including deemed-service provisions.</label>
  </>}
  <label className={s.field}>Contractual completion date<input type="date" required value={value.dueDate} onChange={e=>{setOverridden(true);change({dueDate:e.target.value})}}/></label>
  {value.basis==='on_notice'&&<button type="button" className={s.button} onClick={()=>{setOverridden(false);change({dueDate:noticeDeadline(value.serviceDate,terms.workingDays)})}}>Use calculated deadline</button>}
  <label className={s.field}>{value.basis==='fixed_date'?'Fixed-date agreement / contract reference':'Override or correction reason (required when changing the calculated deadline)'}<textarea maxLength={2000} value={value.reason} onChange={e=>change({reason:e.target.value})}/></label>
  <p className={s.meta}>Historical dates are allowed. Corrections and overrides are recorded in the sale history.</p>
  {error&&<p role="status">{error}</p>}
 </fieldset>;
}
