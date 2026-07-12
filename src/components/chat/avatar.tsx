'use client'

interface AvatarProps {
  name: string
  color?: string
  size?: 'sm' | 'md' | 'lg' | 'xl'
  online?: boolean
  showStatus?: boolean
  src?: string | null
}

const sizeMap = {
  sm: 'h-8 w-8 text-xs',
  md: 'h-10 w-10 text-sm',
  lg: 'h-12 w-12 text-base',
  xl: 'h-16 w-16 text-lg',
}

const dotSize = {
  sm: 'h-2 w-2',
  md: 'h-2.5 w-2.5',
  lg: 'h-3 w-3',
  xl: 'h-3.5 w-3.5',
}

export function Avatar({
  name,
  color = '#0ea5e9',
  size = 'md',
  online,
  showStatus = false,
  src,
}: AvatarProps) {
  const initials = name
    .split(' ')
    .map((w) => w[0])
    .slice(0, 2)
    .join('')
    .toUpperCase()

  return (
    <div className="relative inline-flex flex-shrink-0">
      {src ? (
        <img
          src={src}
          alt={name}
          className={`${sizeMap[size]} rounded-full object-cover ring-1 ring-black/5`}
        />
      ) : (
        <div
          className={`${sizeMap[size]} rounded-full flex items-center justify-center font-semibold text-white shadow-sm`}
          style={{ background: `linear-gradient(135deg, ${color}, ${shadeColor(color, -15)})` }}
        >
          {initials}
        </div>
      )}
      {showStatus && (
        <span
          className={`absolute bottom-0 right-0 ${dotSize[size]} rounded-full border-2 border-[#F7F5F2] dark:border-[#1C1C1E] ${
            online === true
              ? 'bg-emerald-500'
              : online === false
              ? 'bg-slate-400'
              : 'bg-amber-400'
          }`}
        />
      )}
    </div>
  )
}

// Lighten or darken a hex color by a percentage (-100 to 100)
function shadeColor(hex: string, percent: number): string {
  try {
    const num = parseInt(hex.replace('#', ''), 16)
    const r = Math.max(0, Math.min(255, (num >> 16) + Math.round(2.55 * percent)))
    const g = Math.max(0, Math.min(255, ((num >> 8) & 0xff) + Math.round(2.55 * percent)))
    const b = Math.max(0, Math.min(255, (num & 0xff) + Math.round(2.55 * percent)))
    return `#${((r << 16) | (g << 8) | b).toString(16).padStart(6, '0')}`
  } catch {
    return hex
  }
}
