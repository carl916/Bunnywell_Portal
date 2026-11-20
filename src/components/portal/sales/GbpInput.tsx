"use client";

import {useLayoutEffect,useRef,type ComponentPropsWithoutRef} from 'react';
import {formatGbp,formatGbpInputValue,gbpEditingValue,blurGbpInputValue,gbpInputError} from '@/lib/sales/currency';

type GbpInputProps=Omit<ComponentPropsWithoutRef<'input'>,'value'|'onChange'|'type'|'inputMode'> & {
  value:string;
  onChange:(value:string)=>void;
  allowNegative?:boolean;
};
function caretPosition(value:string,characters:number){
  if(!characters)return 0;
  for(let i=0;i<value.length;i++)if(/[\d.-]/.test(value[i])&&!--characters)return i+1;
  return value.length;
}

export function GbpInput({value,onChange,className='',min=0,max,step=0.01,allowNegative=Number(min)<0,name,onBlur,onKeyDown,...props}:GbpInputProps){
  const inputRef=useRef<HTMLInputElement>(null),caret=useRef<number|null>(null);
  useLayoutEffect(()=>{
    const input=inputRef.current;if(!input)return;
    input.setCustomValidity(gbpInputError(value,{min,max,step,allowNegative}));
    if(caret.current!==null&&document.activeElement===input){const position=caretPosition(input.value,caret.current);input.setSelectionRange(position,position);caret.current=null;}
  });
  return <div className={`gbp-input numeric-value ${className}`} data-disabled={props.disabled?'true':'false'}>
    <span className="gbp-input-prefix" aria-hidden="true">£</span>
    <input {...props} ref={inputRef} className="gbp-input-control" type="text" inputMode="decimal" value={formatGbpInputValue(value)}
      onKeyDown={event=>{
        onKeyDown?.(event);if(event.defaultPrevented)return;
        const input=event.currentTarget,start=input.selectionStart??0,end=input.selectionEnd??0;
        // Delete the adjacent digit with its grouping separator, rather than
        // putting the comma straight back and swallowing the user's deletion.
        if(start===end){if(event.key==='Backspace'&&input.value[start-1]===',')input.setSelectionRange(Math.max(0,start-2),start);
        if(event.key==='Delete'&&input.value[start]===',')input.setSelectionRange(start,start+2);}
      }}
      onChange={event=>{
        const input=event.currentTarget,raw=gbpEditingValue(input.value,allowNegative);
        if(raw===null)return;
        caret.current=input.value.slice(0,input.selectionStart??input.value.length).replace(/[^\d.-]/g,'').length;
        input.setCustomValidity(gbpInputError(raw,{min,max,step,allowNegative}));
        onChange(raw);
        // React may skip a render if only a comma was removed.
        queueMicrotask(()=>{if(document.activeElement===input&&caret.current!==null){const position=caretPosition(input.value,caret.current);input.setSelectionRange(position,position);caret.current=null;}});
      }}
      onBlur={event=>{caret.current=null;const raw=blurGbpInputValue(value,allowNegative);if(raw!==value)onChange(raw);onBlur?.(event);}}
    />
    {name&&<input type="hidden" name={name} value={value} disabled={props.disabled}/>}
  </div>;
}

export function GbpValue({value,className=''}:{value:string|number|null|undefined;className?:string}){
  return <span className={`numeric-value text-right ${className}`}>{formatGbp(value)}</span>;
}
