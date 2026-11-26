// Client-side fetch for organizer pages: an expired session (401) sends the
// operator back to /login and then returns them to the page they were on,
// instead of the page looking like an outage.
let redirecting = false;

export async function adminFetch(input: RequestInfo | URL, init?: RequestInit) {
  const response = await fetch(input, init);
  if (response.status === 401 && typeof window !== "undefined" && !redirecting) {
    redirecting = true;
    const next = `${window.location.pathname}${window.location.search}${window.location.hash}`;
    window.location.assign(`/login?next=${encodeURIComponent(next)}`);
  }
  return response;
}
