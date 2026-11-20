import type {ReactNode} from 'react';
import s from '../sales-workspace/Workspace.module.css';
import info from './SalesInformation.module.css';
import {RecordValue} from './ProgressionRecord';
export type InformationGroup={id:string;title:string;fields:[string,string][]};
export function RecordFields({group,compact=false}:{group:InformationGroup;compact?:boolean}){
 const fields=compact?group.fields.filter(([,value])=>value!=='Not recorded'):group.fields;
 if(!fields.length)return null;
 return <section className={`${s.recordInformation} ${info.information}`}><h2>{group.title}</h2><InformationFields fields={fields}/></section>;
}
export function InformationFields({fields}:{fields:[string,string][]}){
 return <dl className={info.fields}>{fields.map(([name,value])=><div key={name}><dt>{name}</dt><dd><RecordValue value={value}/></dd></div>)}</dl>;
}
export function SupportingInformation({title='Supporting information and history',children}:{title?:string;children:ReactNode}){
 return <details className={s.supportingInformation}><summary>{title}</summary><div>{children}</div></details>;
}
