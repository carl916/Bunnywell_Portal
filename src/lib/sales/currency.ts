export function gbpEditingValue(value: string, allowNegative=false):string|null {
  const raw=value.replace(/GBP/gi,'').replace(/[£,\s]/g,'');
  return (allowNegative?/^-?\d*(?:\.\d{0,2})?$/:/^\d*(?:\.\d{0,2})?$/).test(raw)?raw:null;
}

export function parseGbpInput(value: string | number | null | undefined, allowNegative=false) {
  if (value === null || value === undefined || value === "") return null;
  const raw=gbpEditingValue(String(value),allowNegative);
  if(raw===null||!/\d/.test(raw))return null;
  const numeric=Number(raw);
  return Number.isFinite(numeric)?numeric:null;
}

export function formatGbp(value: string | number | null | undefined, fallback = "-") {
  const numeric = typeof value === "string" ? parseGbpInput(value) : value;
  if (numeric === null || numeric === undefined || Number.isNaN(Number(numeric))) return fallback;
  return new Intl.NumberFormat("en-GB", { style: "currency", currency: "GBP", maximumFractionDigits: 0 }).format(Number(numeric));
}

export function formatGbpDeduction(value: string | number | null | undefined) {
  const numeric = typeof value === "string" ? parseGbpInput(value) : value;
  if (!numeric || Number.isNaN(Number(numeric))) return formatGbp(0);
  return `-${formatGbp(numeric)}`;
}

export function formatGbpInputValue(value: string | number | null | undefined) {
  const raw=gbpEditingValue(String(value??''),true);
  if(raw===null)return '';
  const [whole,fraction]=raw.split('.');
  return whole.replace(/\B(?=(\d{3})+(?!\d))/g,',')+(fraction===undefined?'':'.'+fraction);
}

export function rawGbpInputValue(value: string | number | null | undefined) {
  return gbpEditingValue(String(value??''))??'';
}

export function blurGbpInputValue(value:string,allowNegative=false){
  const numeric=parseGbpInput(value,allowNegative);
  if(numeric===null)return value;
  return value.includes('.')&&value.split('.')[1]?numeric.toFixed(2):String(numeric);
}

export function gbpInputError(value:string,{min=0,max,step=0.01,allowNegative=false}:{min?:number|string;max?:number|string;step?:number|string;allowNegative?:boolean}={}){
  if(value==='')return '';
  const amount=parseGbpInput(value,allowNegative);
  if(amount===null)return 'Enter a valid GBP amount with up to two decimal places.';
  if(amount<Number(min))return `Enter an amount of at least £${formatGbpInputValue(min)}.`;
  if(max!==undefined&&amount>Number(max))return `Enter an amount no greater than £${formatGbpInputValue(max)}.`;
  if(step!=='any'&&Number(step)>0){const units=(amount-Number(min))/Number(step);if(Math.abs(units-Math.round(units))>0.000001)return `Enter an amount in increments of £${step}.`;}
  return '';
}
