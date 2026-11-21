export const snagNotificationRoles = [
  { id: 'responsible', label: 'Responsible party' },
  { id: 'developer', label: 'Developers' },
  { id: 'developer_representative', label: 'Developer representatives' },
  { id: 'contractor', label: 'Contractors' },
] as const;

export type SnagNotificationRole = typeof snagNotificationRoles[number]['id'] | 'mentioned';
export type SnagNotificationMode = 'immediate' | 'digest' | 'off';
export type SnagDigestFrequency = 'immediate_only' | 'daily' | 'twice_daily' | 'disabled';
export type SnagNotificationEvent = {
  id: string;
  label: string;
  mode: SnagNotificationMode;
  roles: SnagNotificationRole[];
  required: boolean;
  digestAllowed: boolean;
  rolesLocked: boolean;
};
export type SnagNotificationSettings = {
  version: number;
  frequency: SnagDigestFrequency;
  updatedAt: string | null;
  events: SnagNotificationEvent[];
};
