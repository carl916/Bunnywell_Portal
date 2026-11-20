import s from '../sales-workspace/Workspace.module.css';
import info from './SalesInformation.module.css';
export default function RecordReadStatus({loading,error,retry,compact=false,initial=false}:{loading:boolean;error:string;retry:()=>void;compact?:boolean;initial?:boolean}){
 // Retained records refresh silently so navigation never inserts a status row.
 if(!error&&!(initial&&loading))return null;
 return <div className={info.readStatus} data-compact={compact||undefined}>{error?<p role="alert" title={error}>{initial?'Could not load this record.':'Refresh failed. Showing previous information.'} <button className={s.textButton} onClick={retry}>{initial?'Retry':'Retry refresh'}</button></p>:<p role="status">Loading record…</p>}</div>;
}
