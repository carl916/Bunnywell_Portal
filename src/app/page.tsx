import {redirect} from 'next/navigation';
import { ProductionPortalApp } from '@/components/portal/ProductionPortalApp';
export default function Home(){ if(process.env.NEXT_PUBLIC_WORKSPACE_STAGING === '1') redirect('/workspace'); return <ProductionPortalApp/>; }
