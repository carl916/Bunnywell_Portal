const showEnvironmentBanner = process.env.NEXT_PUBLIC_SHOW_ENV_BANNER === "true";
const environmentName = (process.env.NEXT_PUBLIC_PORTAL_ENV?.trim() || "NON-PRODUCTION").toUpperCase();
const environmentLabel = environmentName === "PRODUCTION" ? environmentName : `${environmentName} - NOT LIVE`;

export function EnvironmentBanner() {
  if (!showEnvironmentBanner) return null;

  return (
    <div className="border-b border-[#e7c37d] bg-[#fff8ec] text-[#735327]" role="status" aria-label="Portal environment">
      <div className="mx-auto flex max-w-7xl items-center justify-center px-4 py-1.5 text-center text-xs font-bold uppercase tracking-[0.18em] sm:px-6 lg:px-8">
        {environmentLabel}
      </div>
    </div>
  );
}
