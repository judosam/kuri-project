import type { AxiosError } from 'axios';

/**
 * Human-readable message for a failed API call.
 *
 * A bare FastAPI 404 ("Not Found") means the request reached the server but the
 * route does not exist there — almost always a backend process started before
 * the endpoint was written (it serves its old route table until restarted).
 * Saying so beats echoing "Not Found" at the admin.
 */
export function describeApiError(error: unknown, fallback: string): string {
  const err = error as AxiosError<{ detail?: unknown }> | undefined;
  const status = err?.response?.status;
  const detail = err?.response?.data?.detail;

  if (status === 404 && (detail === 'Not Found' || detail == null)) {
    const route = err?.config?.url || 'that endpoint';
    return `The API server has no route for ${route}. It is probably running an older build of the backend — restart it (python start_dev.py) and try again.`;
  }

  if (typeof detail === 'string' && detail) return detail;
  if (err?.response?.status === 413) return 'The file is larger than the server accepts. Split the sheet and import it in parts.';

  const message = (error as { message?: string } | undefined)?.message;
  if (message === 'Network Error') {
    return 'Network Error: could not reach the backend API server. Check that it is running.';
  }
  return message || fallback;
}
