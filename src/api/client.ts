export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message)
  }
}

/** Last response served from the offline cache (set by the service worker), for the "showing cached data" bar. */
export const offlineState: { cachedAt: string | null; listeners: Set<() => void> } = { cachedAt: null, listeners: new Set() }
function setCached(v: string | null) {
  if (offlineState.cachedAt === v) return
  offlineState.cachedAt = v
  offlineState.listeners.forEach((l) => l())
}

async function request<T>(method: string, url: string, body?: unknown): Promise<T> {
  if (method !== 'GET' && typeof navigator !== 'undefined' && navigator.onLine === false) throw new ApiError(0, 'You are offline: changes are disabled until the connection is back')
  const res = await fetch(url, {
    method,
    credentials: 'include',
    headers: { 'X-Requested-With': 'xgallery', ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}) },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  })
  if (res.status === 204) return undefined as T
  const cached = res.headers.get('X-Offline-Cache')
  if (method === 'GET') setCached(cached && cached !== 'none' ? cached : null)
  const data = (await res.json().catch(() => ({}))) as { error?: string }
  // Only the guards' own message means the session is gone; wrong passwords/PINs are 401s too but stay on the page.
  if (res.status === 401 && data.error === 'Sign in required' && !/^\/api\/auth\/(login|me)/.test(url)) authState.listeners.forEach((l) => l())
  if (!res.ok) throw new ApiError(res.status, data.error ?? res.statusText)
  return data as T
}

/** Fired when the server answers 401 to a signed-in page: the session ended (sign-out elsewhere, owner reset, expiry). */
export const authState: { listeners: Set<() => void> } = { listeners: new Set() }

export const api = {
  get: <T>(url: string) => request<T>('GET', url),
  post: <T>(url: string, body?: unknown) => request<T>('POST', url, body ?? {}),
  put: <T>(url: string, body?: unknown) => request<T>('PUT', url, body ?? {}),
  patch: <T>(url: string, body?: unknown) => request<T>('PATCH', url, body ?? {}),
  del: <T>(url: string, body?: unknown) => request<T>('DELETE', url, body),
}

/** Uploads a raw body with progress reporting. */
export function uploadRaw(url: string, blob: Blob, contentType: string, meta: Record<string, unknown>, onProgress?: (fraction: number) => void): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest()
    xhr.open('POST', url)
    xhr.withCredentials = true
    xhr.setRequestHeader('Content-Type', contentType)
    xhr.setRequestHeader('X-Requested-With', 'xgallery')
    xhr.setRequestHeader('x-meta', btoa(unescape(encodeURIComponent(JSON.stringify(meta)))))
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable && onProgress) onProgress(e.loaded / e.total)
    }
    xhr.onload = () => {
      let data: unknown = {}
      try {
        data = JSON.parse(xhr.responseText)
      } catch {
        /* empty */
      }
      if (xhr.status >= 200 && xhr.status < 300) resolve(data)
      else reject(new ApiError(xhr.status, (data as { error?: string }).error ?? `Upload failed (${xhr.status})`))
    }
    xhr.onerror = () => reject(new ApiError(0, 'Network error during upload'))
    xhr.send(blob)
  })
}
