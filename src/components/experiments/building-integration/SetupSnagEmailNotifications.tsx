'use client';

import { useState } from 'react';
import type { Session } from '@/lib/experiments/building-integration/reader';
import { snagNotificationRoles, type SnagDigestFrequency, type SnagNotificationEvent,
  type SnagNotificationMode, type SnagNotificationSettings } from '@/lib/workspace/snag-notification-settings';
import { OperationError, useOperation } from './OperationsForms';
import { SetupForm, useSetupRead } from './SetupShared';
import { SetupFeedback, useSetupFeedback } from './SetupFeedback';
import { Notice } from './TaskWorkspace';
import s from '../sales-workspace/Workspace.module.css';
import styles from './SetupEmailNotifications.module.css';

export function SetupSnagEmailNotifications({ session }: { session: Session }) {
  const [refresh, setRefresh] = useState(0);
  const reload = () => setRefresh(value => value + 1);
  const { data, error } = useSetupRead<SnagNotificationSettings>(session, 'snag-email-notifications', {}, refresh);
  if (error) return <Notice>{error} <button type="button" className={s.button} onClick={reload}>Retry settings</button></Notice>;
  if (!data) return <Notice>Loading snagging notification settings…</Notice>;
  return <SnagNotificationForm key={data.version + ':' + refresh} session={session} initial={data} reload={reload} />;
}

function SnagNotificationForm({ session, initial, reload }: {
  session: Session;
  initial: SnagNotificationSettings;
  reload: () => void;
}) {
  const [saved, setSaved] = useState(initial);
  const [settings, setSettings] = useState(initial);
  const { message, show } = useSetupFeedback('snag-email-notifications');
  const { busy, error, run } = useOperation(session, show);
  const dirty = settings.frequency !== saved.frequency || JSON.stringify(settings.events) !== JSON.stringify(saved.events);
  const missingRecipients = settings.events.some(event => event.mode !== 'off' && event.roles.length === 0);

  function updateEvent(id: string, changes: Partial<Pick<SnagNotificationEvent, 'mode' | 'roles'>>) {
    show('');
    setSettings(value => ({
      ...value,
      events: value.events.map(event => event.id === id ? { ...event, ...changes } : event),
    }));
  }

  return <section className={s.card} aria-labelledby="snag-notification-title">
    <h2 id="snag-notification-title">Snagging notifications</h2>
    <p className={styles.scope}><strong>System-wide · All buildings</strong></p>
    <p>Digests group activity by building. P1 alerts, information requests, developer reviews and mentions are always immediate.</p>
    <SetupForm onSubmit={event => {
      event.preventDefault();
      if (!dirty || missingRecipients) return;
      void run({ action: 'save_snag_notifications', payload: {
        expectedVersion: saved.version,
        frequency: settings.frequency,
        events: Object.fromEntries(settings.events.map(row => [row.id, { mode: row.mode, roles: row.roles }])),
      } }, 'Snagging notification settings saved.').then(result => {
        if (!result) return;
        const next = result as unknown as SnagNotificationSettings;
        setSaved(next);
        setSettings(next);
      });
    }}>
      <OperationError error={error} />
      {error && <button type="button" className={s.button} onClick={() => {
        if (!dirty || window.confirm('Discard unsaved changes and reload settings?')) reload();
      }}>Reload settings</button>}
      <fieldset disabled={busy} className={styles.snagEvent}>
        <legend>Digest schedule</legend>
        <label className={`${s.field} ${styles.frequency}`}>
          Frequency
          <select value={settings.frequency} onChange={event => {
            show('');
            const frequency = event.target.value as SnagDigestFrequency;
            setSettings(value => ({ ...value, frequency }));
          }}>
            <option value="immediate_only">Immediate notifications only</option>
            <option value="daily">Daily at 16:00 UK time</option>
            <option value="twice_daily">Twice daily at 12:00 and 16:00 UK time</option>
            <option value="disabled">Optional notifications disabled</option>
          </select>
        </label>
        <p className={styles.eventHint}>The digest schedule applies to events set to Digest. Required alerts continue with every schedule.</p>
      </fieldset>
      <div className={styles.snagEvents}>
        {settings.events.map(event => <fieldset key={event.id} className={styles.snagEvent} disabled={busy}>
          <legend>{event.label}</legend>
          {event.required ? <p className={styles.eventHint}>Immediate alert</p>
            : <label className={s.field}>Delivery
              <select aria-label={event.label + ' delivery'} value={event.mode} onChange={change => {
                updateEvent(event.id, { mode: change.target.value as SnagNotificationMode });
              }}>
                <option value="immediate">Immediate</option>
                {event.digestAllowed && <option value="digest">Digest</option>}
                <option value="off">Off</option>
              </select>
            </label>}
          {event.rolesLocked ? <p className={styles.eventHint}>{event.id === 'mentioned' ? 'People mentioned in the comment' : 'Responsible developer-side recipient'}</p>
            : <div className={styles.recipients}>
              {snagNotificationRoles.map(role => <label key={role.id} className={styles.choice}>
                <input type="checkbox" checked={event.roles.includes(role.id)} disabled={event.mode === 'off'}
                  aria-label={event.label + ' · ' + role.label} onChange={change => {
                    const roles = snagNotificationRoles.map(item => item.id)
                      .filter(id => id === role.id ? change.target.checked : event.roles.includes(id));
                    updateEvent(event.id, { roles });
                  }} />
                <span>{role.label}</span>
              </label>)}
            </div>}
        </fieldset>)}
      </div>
      <div className={styles.actions}>
        <button className={s.primary} disabled={busy || !dirty || missingRecipients}>{busy ? 'Saving…' : 'Save changes'}</button>
        {missingRecipients && <span role="status">Choose a recipient for each enabled event.</span>}
      </div>
      <SetupFeedback message={message} />
    </SetupForm>
  </section>;
}
