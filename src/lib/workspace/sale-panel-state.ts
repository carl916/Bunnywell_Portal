export type InformationTab='overview'|'comments'|'activity';
export type SalePanelState={tab:InformationTab;draft:string;mentionIds?:string[]};
const prefix='bunnywell:sale-information:';
const initial:SalePanelState={tab:'overview',draft:''};
export function salePanelKey(access:string,building:string,unit:string,sale:string|null){return [access,building,unit,sale||'no-sale'].join(':');}
export function readSalePanel(key:string):SalePanelState{
 try{const value=JSON.parse(sessionStorage.getItem(prefix+key)||'null');return value?{tab:['overview','comments','activity'].includes(value.tab)?value.tab:'overview',draft:typeof value.draft==='string'?value.draft:'',mentionIds:Array.isArray(value.mentionIds)?value.mentionIds.filter((id:unknown)=>typeof id==='string'):[]}:initial;}catch{return initial;}
}
export function writeSalePanel(key:string,patch:Partial<SalePanelState>){try{sessionStorage.setItem(prefix+key,JSON.stringify({...readSalePanel(key),...patch}));}catch{/* In-memory state still works when browser storage is unavailable. */}}
export function clearSalePanels(){try{for(let i=sessionStorage.length-1;i>=0;i--){const key=sessionStorage.key(i);if(key?.startsWith(prefix))sessionStorage.removeItem(key);}}catch{/* Storage may be disabled. */}}
