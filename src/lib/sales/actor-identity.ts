export type SaleActorName = { id: string; display_name: string };

export type ActorProfile = {
  id: string;
  display_name?: string | null;
  email?: string | null;
  name?: string | null;
  full_name?: string | null;
};

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function displayIdentity(value?: string | null) {
  const trimmed = value?.trim();
  return trimmed && !UUID_PATTERN.test(trimmed) ? trimmed : null;
}

export function historicalActorLabel({
  snapshotName,
  snapshotEmail,
  userId,
  profiles,
  fallback = "Not recorded",
}: {
  snapshotName?: string | null;
  snapshotEmail?: string | null;
  userId?: string | null;
  profiles: ActorProfile[];
  fallback?: string;
}) {
  const profile = userId ? profiles.find((candidate) => candidate.id === userId) : undefined;

  return displayIdentity(snapshotName)
    ?? displayIdentity(profile?.display_name)
    ?? displayIdentity(profile?.full_name)
    ?? displayIdentity(profile?.name)
    ?? displayIdentity(snapshotEmail)
    ?? displayIdentity(profile?.email)
    ?? fallback;
}

// Workflow snapshots describe the action at the time it happened. A profile
// lookup supplies only a name; its current role is never historical audit data.
export function workflowActorLabel(
  event: { created_by_user_id?: string | null; actor_name?: string | null } | undefined,
  profiles: ActorProfile[],
  fallbackUserId?: string | null,
  fallback = "Unknown user",
) {
  const userId = event?.created_by_user_id ?? fallbackUserId;
  return historicalActorLabel({
    userId,
    // An event with no identity must not borrow a name from a different actor.
    snapshotName: event?.created_by_user_id ? event.actor_name : undefined,
    profiles,
    fallback,
  });
}
