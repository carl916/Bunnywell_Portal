"use client";
import { useState } from 'react';
import type { Session } from '@/lib/experiments/building-integration/reader';
import { notificationRoles, type EmailNotificationSettings, type NotificationRole } from '@/lib/workspace/email-notifications';
import { useSetupRead, SetupForm } from './SetupShared';
import { FormFields, OperationError, useOperation } from './OperationsForms';
import { Notice } from './TaskWorkspace';
import {SetupFeedback,useSetupFeedback} from './SetupFeedback';
import s from '../sales-workspace/Workspace.module.css';
import styles from './SetupEmailNotifications.module.css';

export default function SetupEmailNotifications({ session }: { session: Session }) {
  const [refresh, setRefresh] = useState(0);
  const { data, error } = useSetupRead<EmailNotificationSettings>(session, 'email-notifications', {}, refresh);
  if (error) return <Notice>{error} <button className={s.button} onClick={() => setRefresh(value => value + 1)}>Retry settings</button></Notice>;
  if (!data) return <Notice>Loading email notification settings…</Notice>;
  return <EmailNotificationForm key={data.version + ':' + refresh} session={session} initial={data} reload={() => setRefresh(value => value + 1)} />;
}

function EmailNotificationForm({ session, initial, reload }: { session: Session; initial: EmailNotificationSettings; reload: () => void }) {
  const [settings, setSettings] = useState(initial), [saved, setSaved] = useState(initial);
  const {message,show:setMessage}=useSetupFeedback('email-notifications');
  const { busy, error, run } = useOperation(session, setMessage);
  const dirty = JSON.stringify(settings.events) !== JSON.stringify(saved.events);
  const mention = settings.events.find(event => event.kind === 'mention')!;
  function toggleRole(id: string, role: NotificationRole, checked: boolean) {
    setMessage('');
    setSettings(value => ({ ...value, events: value.events.map(event => event.id === id
      ? { ...event, roles: notificationRoles.map(item => item.id).filter(item => item === role ? checked : event.roles.includes(item)) }
      : event) }));
  }
  return <section className={s.card} aria-labelledby="email-notifications-title">
    <h2 id="email-notifications-title">Email notifications</h2>
    <p className={styles.scope}><strong>System-wide · All buildings</strong></p>
    <p role="note">Staging test copies go only to carl@accoladeproperties.co.uk and identify the intended recipient. Formal legal emails keep their separate issue workflow.</p>
    <p>Choose which portal roles receive each sales notification. Each event is queued immediately for eligible users with access to that sale, including the person who acted. Clear all roles to switch off role-based emails for an event.</p>
    <SetupForm onSubmit={event => {
      event.preventDefault();
      void run({ action: 'save_email_notifications', payload: {
        expectedVersion: saved.version,
        roles: Object.fromEntries(settings.events.filter(item => item.kind === 'roles').map(item => [item.id, item.roles])),
        mentionsEnabled: mention.enabled,
      } }, 'Email notification settings saved for all buildings.').then(result => {
        if (result) { const updated = result as unknown as EmailNotificationSettings; setSaved(updated); setSettings(updated); }
      });
    }}>
      <OperationError error={error} />
      {error && <button type="button" className={s.button} onClick={() => { if (!dirty || window.confirm('Discard unsaved changes and reload the latest settings?')) reload(); }}>Reload latest settings</button>}
      <SetupFeedback message={message}/><FormFields busy={busy}>
        <table className={styles.table}>
          <caption className={styles.caption}>Workflow events and recipient roles</caption>
          <thead><tr><th scope="col">Event</th>{notificationRoles.map(role => <th scope="col" key={role.id}>{role.label}</th>)}</tr></thead>
          <tbody>{settings.events.filter(event => event.kind === 'roles').map(event => <tr key={event.id}>
            <th scope="row">{event.label}</th>
            {notificationRoles.map(role => <td key={role.id}><label className={styles.choice}>
              <input type="checkbox" checked={event.roles.includes(role.id)} aria-label={`${event.label} — ${role.label}`} onChange={change => toggleRole(event.id, role.id, change.target.checked)} />
              <span className={styles.mobileLabel}>{role.label}</span>
            </label></td>)}
          </tr>)}</tbody>
        </table>
        <div className={styles.mention}>
          <div><h3>Mentioned in a comment</h3><p>People tagged in the comment</p><p>Independent of Comment added. Only people who can view the comment are eligible.</p></div>
          <label className={styles.choice}><input type="checkbox" checked={mention.enabled} aria-label="Mentioned in a comment" onChange={event => {
            setMessage(''); const enabled = event.target.checked;
            setSettings(value => ({ ...value, events: value.events.map(item => item.id === mention.id ? { ...item, enabled } : item) }));
          }} /><span>{mention.enabled ? 'On' : 'Off'}</span></label>
        </div>
        <div className={styles.actions}><button type="submit" className={s.primary} disabled={busy || !dirty}>{busy ? 'Saving…' : 'Save changes'}</button><span role="status" aria-live="polite">{dirty ? 'Unsaved changes' : 'All changes saved'}</span></div>
      </FormFields>
    </SetupForm>
  </section>;
}
