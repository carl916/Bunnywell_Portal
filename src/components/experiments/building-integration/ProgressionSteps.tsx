import {Check, Circle, Clock3} from 'lucide-react';
import s from './Progression.module.css';

export type ProgressionStep={id:string;title:string;status:string;state:'complete'|'current'|'future'|'optional'|'missing'};

/** Selection describes the page being read; state describes the persisted record. */
export default function ProgressionSteps({label,steps,selected,onSelect}:{label:string;steps:ProgressionStep[];selected:string;onSelect:(id:string)=>void}){
 return <nav className={s.steps} aria-label={label}><ol>{steps.map(step=>{
  const Icon=step.state==='complete'?Check:step.state==='future'?Clock3:Circle;
  return <li key={step.id}><button type="button" aria-current={selected===step.id?'step':undefined} data-stage={step.state} onClick={()=>onSelect(step.id)}>
   <Icon size={16} aria-hidden="true"/><span><strong>{step.title}</strong><small>{step.status}</small></span>
  </button></li>;
 })}</ol></nav>;
}
