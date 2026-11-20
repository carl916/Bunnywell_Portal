export function reservationFieldErrors(form:Record<string,unknown>,today=new Intl.DateTimeFormat('en-CA',{timeZone:'Europe/London'}).format(new Date())){
 const text=(key:string)=>typeof form[key]==='string'?String(form[key]).trim():'';
 const errors:Partial<Record<'buyer'|'buyerEmail'|'buyerPhone'|'buyerSolicitorName'|'reservationDate',string>>={};
 if(!text('buyerPersonName')&&!text('buyerCompanyName'))errors.buyer='Enter a buyer name or company.';
 if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(text('buyerEmail')))errors.buyerEmail='Enter a valid buyer email address.';
 if(!text('buyerPhone'))errors.buyerPhone='Enter the buyer phone number.';
 if(!text('buyerSolicitorName'))errors.buyerSolicitorName='Enter the buyer solicitor.';
 const date=text('reservationDate');
 if(!/^\d{4}-\d{2}-\d{2}$/.test(date)||!Number.isFinite(Date.parse(date))||new Date(date).toISOString().slice(0,10)!==date||date>today)errors.reservationDate='Enter a valid reservation date that is not in the future.';
 return errors;
}

export function reservationErrors(form:Record<string,unknown>,checked:boolean,hasPdf:boolean,today=new Intl.DateTimeFormat('en-CA',{timeZone:'Europe/London'}).format(new Date())){
 const errors=Object.values(reservationFieldErrors(form,today));
 if(!checked)errors.push('Confirm that you checked the commercial terms.');
 if(!hasPdf)errors.push('Select the signed reservation PDF.');
 return errors;
}
