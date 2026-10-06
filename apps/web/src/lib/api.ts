import { auth } from './auth';
export const apiBase = import.meta.env.VITE_API_BASE_URL || '';
export class ApiError extends Error {
  constructor(
    message: string,
    public code?: string,
    public requestId?: string,
  ) {
    super(message);
  }
}
export async function apiVersioned<T>(
  resource: string,
  method = 'GET',
  body?: unknown,
  headers?: Record<string, string>,
): Promise<{ data: T; etag: string | null }> {
  const token = await auth?.currentUser?.getIdToken();
  const response = await fetch(`${apiBase}/api/v1/${resource}`, {
    method,
    headers: {
      ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...headers,
    },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
  const result = await response.json();
  if (!response.ok || !result.success)
    throw new ApiError(
      result.error?.message || 'Unable to complete your request.',
      result.error?.code,
      result.error?.requestId,
    );
  return { data: result.data as T, etag: response.headers.get('ETag') };
}
export async function api<T>(
  resource: string,
  method = 'GET',
  body?: unknown,
  headers?: Record<string, string>,
): Promise<T> {
  return (await apiVersioned<T>(resource, method, body, headers)).data;
}
export type Page<T> = { items: T[]; nextCursor: string | null; legacyBefore?: number };
export async function apiPage<T>(resource: string, order: string, limit: number): Promise<Page<T>> {
  const data = await api<Page<T> | T[]>(resource);
  // Accept array responses during a rolling local upgrade and in older integrations.
  if (Array.isArray(data))
    return {
      items: data,
      nextCursor: null,
      legacyBefore:
        data.length === limit
          ? Number((data.at(-1) as Record<string, unknown>)?.[order])
          : undefined,
    };
  return data;
}
