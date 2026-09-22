/**
 * The host this dashboard was reached at, for building addresses of the
 * services beside it.
 *
 * Docker reports a published port as bound to 0.0.0.0, which is not somewhere
 * anyone can go. Whatever the iPad typed to reach the dashboard is, on a home
 * network, the same box the containers are on - so that is the address worth
 * showing. It never changes while the page is open, so there is nothing to
 * subscribe to.
 */
export function useHostname(): string {
  return window.location.hostname;
}
