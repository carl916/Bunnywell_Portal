type AuthError = { status?: number; name?: string; message: string };

// A failed connection is not proof that an account has signed out. Only a
// definitive Auth rejection may settle restoration as unauthenticated.
export function verifiedSessionUser<T>(result: {
  data: { user: T | null };
  error: AuthError | null;
}): T | null {
  if (!result.error) return result.data.user;
  if (result.error.name === "AuthSessionMissingError" ||
      [400, 401, 403].includes(result.error.status ?? 0)) return null;
  throw result.error;
}
