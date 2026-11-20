import {NextResponse} from 'next/server';
import {setupAccountActor,createAccount,type AccountFields} from '@/lib/workspace/setup-account';
import {ReadError} from '@/lib/workspace/server';
export async function POST(request:Request){
 try{
  const {client,v}=await setupAccountActor(request),raw=await request.text();if(raw.length>24000)throw new ReadError('Request too large.',413);const p=JSON.parse(raw);
  if(p.action==='create')return NextResponse.json(await createAccount(client,p as AccountFields,request));
  if(p.action==='status'){
   if(p.userId===v.profile.id||typeof p.active!=='boolean')throw new ReadError('Choose another account and a valid status.',400);
   const current=await client.from('profiles').select('updated_at').eq('id',p.userId).single();if(current.error||Date.parse(current.data.updated_at)!==Date.parse(p.expected))throw new ReadError('Account changed. Reload before saving.',409);
   if(p.active){const unban=await client.auth.admin.updateUserById(p.userId,{ban_duration:'none'});if(unban.error)throw new ReadError(unban.error.message,400);}
   const saved=await client.rpc('workspace_setup_operation',{p_actor:v.profile.id,p_request:crypto.randomUUID(),p_action:'set_person_status',p_target:p.userId,p_payload:{active:p.active,expected:p.expected}});if(saved.error)throw new ReadError(saved.error.message,409);
   return NextResponse.json(saved.data);
  }
  if(!['send_login_reminder','send_password_reset'].includes(p.action))throw new ReadError('Account action unavailable.',400);
  const r=await client.from('profiles').select('email,active').eq('id',p.userId).single();if(r.error||!r.data.active)throw new ReadError('Choose an active account.',400);

  const redirectTo=new URL('/workspace?view=password-setup',request.url).toString();
  const sent=p.action==='send_password_reset'?await client.auth.resetPasswordForEmail(r.data.email,{redirectTo}):await client.auth.signInWithOtp({email:r.data.email,options:{shouldCreateUser:false,emailRedirectTo:redirectTo}});
  if(sent.error)throw new ReadError(sent.error.message,400);return NextResponse.json({sent:true});
 }catch(e){return NextResponse.json({error:e instanceof Error?e.message:'Account action failed.'},{status:e instanceof ReadError?e.status:500})}
}
