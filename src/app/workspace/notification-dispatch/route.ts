import {dispatchAuthorised,dispatchNotifications} from '@/lib/workspace/notification-dispatch';
import {dispatchSnagNotifications} from '@/lib/workspace/snag-notification-dispatch';
export const runtime='nodejs';
export const maxDuration=60;
export async function POST(request:Request){
 if(!dispatchAuthorised(request.headers.get('authorization')))return Response.json({error:'Unauthorised dispatcher.'},{status:401});
 const [sales,snagging]=await Promise.allSettled([dispatchNotifications(),dispatchSnagNotifications()]);
 const failed=sales.status==='rejected'||snagging.status==='rejected';
 if(failed)console.error('Staging notification worker could not finish.',{sales:sales.status,snagging:snagging.status});
 return Response.json({
  ...(sales.status==='fulfilled'?sales.value:{sales:'retry_pending'}),
  snagging:snagging.status==='fulfilled'?snagging.value:{status:'retry_pending'},
 },{status:failed?503:200,headers:{'Cache-Control':'no-store'}});
}
