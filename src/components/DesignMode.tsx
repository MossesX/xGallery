import { useEffect, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { Pencil, X } from 'lucide-react'
import { useMe } from '../api/hooks'
import { useUI } from '../store/ui'

/** Which editable regions exist on a page, and which developer-panel page edits each. */
const REGIONS: { selector: string; label: string; to: string }[] = [
  { selector: '.banner-nav', label: 'Navigation menu', to: '/dev/navigation' },
  { selector: '.banner-right', label: 'Toolbar', to: '/dev/toolbar' },
  { selector: '.banner-brand', label: 'Brand & banner', to: '/dev/layout' },
  { selector: '.footer', label: 'Footer', to: '/dev/footer' },
  { selector: '.hero-feature', label: 'Home: hero', to: '/dev/home' },
  { selector: '[data-section]', label: 'Home section', to: '/dev/home' },
  { selector: '.media-layout', label: 'Album layout', to: '/dev/appearance' },
  { selector: '.ctx-menu', label: 'Context menu', to: '/dev/context-menu' },
]

interface Handle {
  label: string
  to: string
  top: number
  left: number
  width: number
  height: number
}

/** Design mode: outlines every editable region of the current page with an "Edit" handle that opens its editor. */
export function DesignMode() {
  const { data: me } = useMe()
  const on = useUI((s) => s.designMode)
  const setOn = useUI((s) => s.setDesignMode)
  const navigate = useNavigate()
  const location = useLocation()
  const [handles, setHandles] = useState<Handle[]>([])
  const active = on && me?.role === 'owner' && !location.pathname.startsWith('/dev')

  useEffect(() => {
    if (!active) {
      setHandles([])
      return
    }
    const measure = () => {
      const out: Handle[] = []
      for (const r of REGIONS) {
        document.querySelectorAll<HTMLElement>(r.selector).forEach((el) => {
          const b = el.getBoundingClientRect()
          if (b.width < 20 || b.height < 10) return
          const label = el.dataset.section ? `Home: ${el.dataset.sectionTitle || el.dataset.section}` : r.label
          out.push({ label, to: el.dataset.section ? `${r.to}?section=${el.dataset.section}` : r.to, top: b.top + window.scrollY, left: b.left + window.scrollX, width: b.width, height: b.height })
        })
      }
      setHandles(out)
    }
    measure()
    const t = setInterval(measure, 800)
    window.addEventListener('resize', measure)
    window.addEventListener('scroll', measure, true)
    return () => {
      clearInterval(t)
      window.removeEventListener('resize', measure)
      window.removeEventListener('scroll', measure, true)
    }
  }, [active, location.pathname])

  if (!active) return null
  return (
    <>
      {handles.map((h, i) => (
        <div key={i} className="design-handle" style={{ top: h.top, left: h.left, width: h.width, height: h.height }}>
          <button className="design-edit" onClick={() => navigate(h.to)} title={`Edit: ${h.label}`}>
            <Pencil size={11} /> {h.label}
          </button>
        </div>
      ))}
      <div className="design-bar">
        <span>
          <Pencil size={13} /> Design mode: click an Edit handle to change that part of the site
        </span>
        <button className="btn sm" onClick={() => navigate('/dev')}>
          Developer panel
        </button>
        <button className="btn ghost icon sm" onClick={() => setOn(false)} title="Exit design mode">
          <X size={14} />
        </button>
      </div>
    </>
  )
}
