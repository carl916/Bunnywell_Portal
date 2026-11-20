export function depositPosition(expected:number|null|undefined,received:number|null|undefined){
 const knownExpected=expected!=null&&Number.isFinite(Number(expected))?Number(expected):null;
 const knownReceived=received!=null&&Number.isFinite(Number(received))?Number(received):null;
 return {expected:knownExpected,received:knownReceived,outstanding:knownExpected!==null&&knownReceived!==null?Math.max(0,Math.round((knownExpected-knownReceived)*100)/100):null,
 status:knownReceived===null?'Not recorded':knownExpected===null?'Receipt recorded · expected amount unavailable':knownReceived>=knownExpected?'Received in full':'Partially received'};
}
