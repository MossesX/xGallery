export function Avatar({ name, size = 34, src }: { name: string; size?: number; src?: string | null }) {
  const initials = name
    .split(/\s+/)
    .map((p) => p[0])
    .filter(Boolean)
    .slice(0, 2)
    .join('')
  let hue = 0
  for (const ch of name) hue = (hue * 31 + ch.charCodeAt(0)) % 360
  if (src) return <img className="avatar avatar-img" src={src} alt={name} title={name} width={size} height={size} style={{ width: size, height: size }} loading="lazy" />
  return (
    <div className="avatar" style={{ width: size, height: size, fontSize: size * 0.38, background: `hsl(${hue} 55% 45% / 0.18)`, color: `hsl(${hue} 55% 40%)` }} title={name}>
      {initials || '?'}
    </div>
  )
}
