export async function copyText(text: string): Promise<boolean> {
  const value = String(text || '')
  if (!value) return false

  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(value)
      return true
    }
  } catch {
    /* HTTP local, iOS, permissions — fallback below */
  }

  try {
    const field = document.createElement('textarea')
    field.value = value
    field.setAttribute('readonly', '')
    field.setAttribute('aria-hidden', 'true')
    field.style.position = 'fixed'
    field.style.top = '0'
    field.style.left = '0'
    field.style.width = '1px'
    field.style.height = '1px'
    field.style.opacity = '0'
    field.style.fontSize = '16px'
    document.body.appendChild(field)
    field.focus()
    field.select()
    field.setSelectionRange(0, value.length)
    const ok = document.execCommand('copy')
    document.body.removeChild(field)
    return ok
  } catch {
    return false
  }
}

export function canShareText() {
  return typeof navigator !== 'undefined' && typeof navigator.share === 'function'
}

export async function shareText(title: string, text: string): Promise<boolean> {
  if (!canShareText()) return false
  try {
    await navigator.share({ title, text })
    return true
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') return false
    return false
  }
}
