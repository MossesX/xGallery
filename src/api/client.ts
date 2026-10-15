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
  if (!res.ok) throw new ApiError(res.status, data.error ?? res.statusText)
  return data as T
}

export const api = {
  get: <T>(url: string) => request<T>('GET', url),
  post: <T>(url: string, body?: unknown) => request<T>('POST', url, body ?? {}),
  put: <T>(url: string, body?: unknown) => request<T>('PUT', url, body ?? {}),
  del: <T>(url: string) => request<T>('DELETE', url),
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
