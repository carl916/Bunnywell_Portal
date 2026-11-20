"use client";
import {useCallback} from 'react';
import type {reader} from '@/lib/experiments/building-integration/reader';
import type {SaleRow,Scope} from '@/lib/experiments/building-contracts/contracts';
import {useRecordRead} from './useRecordRead';

/** The existing permission-filtered audit page; never reconstruct missing events. */
export function useProgressionHistory(api:ReturnType<typeof reader>,scope:Scope,row:SaleRow,refresh:number){
 const {buildingId,unitId,saleId}=row;
 const read=useCallback((signal:AbortSignal)=>api.workflow.activity({buildingId,unitId,saleId:saleId!},undefined,signal),[api,buildingId,unitId,saleId]);
 return useRecordRead(['progression-history',scope.identity,scope.role,scope.accessRevision,buildingId,unitId,saleId].join(':'),read,refresh);
}
