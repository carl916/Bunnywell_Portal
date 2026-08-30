type ActorProfile = {
  id: string;
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
    ?? displayIdentity(profile?.full_name)
    ?? displayIdentity(profile?.name)
    ?? displayIdentity(snapshotEmail)
    ?? displayIdentity(profile?.email)
    ?? fallback;
}
