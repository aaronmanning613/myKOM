/**
 * Strava's "Connect with Strava" button, drawn to match their official asset (orange #FC5200,
 * 48px tall, white logo and text) per https://developers.strava.com/guidelines/.
 * A plain link: sign-in is a full-page redirect through the API to Strava.
 */
export function ConnectWithStravaButton() {
  return (
    <a
      href="/api/auth/strava"
      className="inline-flex h-12 items-center gap-3 rounded bg-[#FC5200] px-5 font-semibold text-white hover:bg-[#E34A00] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#FC5200]"
    >
      <svg viewBox="0 0 24 24" aria-hidden="true" className="size-6 fill-current">
        <path d="M15.387 17.944l-2.089-4.116h-3.065L15.387 24l5.15-10.172h-3.066m-7.008-5.599l2.836 5.598h4.172L10.463 0l-7 13.828h4.169" />
      </svg>
      Connect with Strava
    </a>
  );
}
