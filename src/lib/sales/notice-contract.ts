import holidays from './england-wales-holidays.json';
import {isCalendarDate,addWorkingDays} from './completion-notice';

export type NoticeTerms = {workingDays:number; serviceProvision:string};
export const defaultNoticeTerms:NoticeTerms={workingDays:10,serviceProvision:''};
export function noticeDeadline(service:string,days=10):string {
 if(!isCalendarDate(service)||!Number.isInteger(days)||days<1||days>90)return '';
 const result=addWorkingDays(service,days,holidays.dates);
 if(Number(service.slice(0,4))<holidays.firstYear||Number(result.slice(0,4))>holidays.lastYear)return '';
 return result;
}
export type NoticeInput={noticeDate:string;serviceDate:string;dueDate:string;basis:'on_notice'|'fixed_date';reason:string;serviceConfirmed:boolean};
export function noticeValidation(input:NoticeInput,terms:NoticeTerms=defaultNoticeTerms){
 if(!isCalendarDate(input.noticeDate)||!isCalendarDate(input.dueDate))return 'Enter valid notice and completion dates.';
 if(input.basis==='fixed_date')return input.reason.trim()?'':'Record the fixed-date agreement or contract reference.';
 if(!isCalendarDate(input.serviceDate)||input.serviceDate<input.noticeDate)return 'Enter the valid service/deemed-service date, on or after issue.';
 if(!input.serviceConfirmed)return 'Confirm the service date against the contractual service provisions.';
 if(input.dueDate<=input.serviceDate)return 'The completion deadline must follow valid service.';
 const expected=noticeDeadline(input.serviceDate,terms.workingDays);
 if(!expected&&!input.reason.trim())return 'Bank holiday coverage is unavailable for this year. Verify the contract and record an override reason.';
 if(input.dueDate!==expected&&!input.reason.trim())return 'A contractual deadline override requires a reason.';
 return '';
}

/** Conservative filename hints only: content and scope remain authoritative. */
export function noticeFilenameWarnings(name:string,unit:string){
 const warnings:string[]=[];
 const normalized=(v:string)=>v.toUpperCase().replace(/^PLOT\s*|^UNIT\s*/,'').replace(/[^A-Z0-9]/g,'').replace(/(\D)0+(\d)/,'$1$2');
 const match=name.match(/(?:^|\b(?:plot|unit)\s+)([A-Z]{0,3}\d{1,4})(?=\s|[-_.])/i);
 if(match&&unit&&normalized(match[1])!==normalized(unit))warnings.push('The filename appears to refer to unit '+match[1]+' rather than '+unit+'.');
 if(/reservation|statement\s+of\s+account|completion\s+statement|invoice/i.test(name))warnings.push('The filename suggests a different document type from a completion notice.');
 return warnings;
}
