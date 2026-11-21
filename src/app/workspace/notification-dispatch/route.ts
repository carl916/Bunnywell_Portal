import {dispatchAuthorised,dispatchNotifications} from '@/lib/workspace/notification-dispatch';
export const runtime='nodejs';
export const maxDuration=60;
export async function POST(request:Request){
 if(!dispatchAuthorised(request.headers.get('authorization')))return Response.json({error:'Unauthorised dispatcher.'},{status:401});
 try{return Response.json(await dispatchNotifications(),{headers:{'Cache-Control':'no-store'}});}
 catch{console.error('Staging notification worker could not finish.');return Response.json({error:'Pending notifications will be checked on the next scheduled run.'},{status:503});}
}
