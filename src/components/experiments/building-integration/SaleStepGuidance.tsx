import type {SaleRow} from '@/lib/experiments/building-contracts/contracts';
import {saleGuidance} from '@/lib/workspace/sale-guidance';
import {LocalLink,saleValues} from './TaskWorkspace';
import info from './SalesInformation.module.css';
export default function SaleStepGuidance({row,role,section,task=''}:{row:SaleRow;role:string;section:string;task?:string}){
 const guidance=saleGuidance(row,role,section,task);
 if(!guidance)return null;
 return <div className={info.guidance}>{guidance.waiting?<p>{guidance.waiting}{!guidance.selected&&<> <LocalLink values={{...saleValues(row),...guidance.destination}}>Review commercial terms</LocalLink></>}</p>:<LocalLink values={{...saleValues(row),...guidance.destination}}>{guidance.title}</LocalLink>}</div>;
}
