import type {Building,BuildingFloor,Organisation,Unit,UnitType,Trade} from '@/lib/data/production';
import type {UnitAllocationAttempt} from '@/lib/units/commercial-allocation';
export type SetupContext={buildings:Building[];organisations:(Organisation&{updated_at:string})[];types:UnitType[];trades:Trade[]};
export type SetupPeople={people:(Profile&{phone?:string|null;updated_at:string;buildingIds:string[];unitAccess:{unitId:string;accessType:string}[]})[];units:Unit[];floors:BuildingFloor[];requests:Record<string,unknown>[]};
export type SetupAllocation={units:(Unit&{updated_at:string})[];workflows:UnitAllocationAttempt[]};

export type Profile={id:string;email:string;name:string|null;full_name:string|null;phone:string|null;role:string;resident_type:string|null;organisation_id:string|null;active:boolean;last_active_at:string|null};
