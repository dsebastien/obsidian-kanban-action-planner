/**
 * A small, dependency-free confetti burst, played when a note's triage is
 * completed (a celebratory cue, à la the journal-bases "entry complete" effect).
 *
 * Pure canvas + `requestAnimationFrame`; the canvas is appended to the host
 * (kept inside `.kap-root` for CSS isolation), animates a single burst, then
 * removes itself. It is purely decorative: `pointer-events: none`, and it
 * self-terminates if the host is detached mid-animation (view closed).
 */

/** Festive palette — fixed colors so the burst reads on any Obsidian theme. */
const COLORS = ['#ef4444', '#f97316', '#eab308', '#22c55e', '#3b82f6', '#a855f7', '#ec4899']

const PARTICLE_COUNT = 110
const DURATION_MS = 1800
const GRAVITY = 0.12
const DRAG = 0.992

interface Particle {
    x: number
    y: number
    vx: number
    vy: number
    size: number
    color: string
    angle: number
    spin: number
}

/**
 * Play one confetti burst over `host`. No-op when the user prefers reduced
 * motion. Safe to call repeatedly — each call mounts and disposes its own canvas.
 */
export function burstConfetti(host: HTMLElement): void {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return

    const rect = host.getBoundingClientRect()
    if (rect.width === 0 || rect.height === 0) return

    const canvas = host.createEl('canvas', { cls: 'kap-confetti' })
    const ctx = canvas.getContext('2d')
    if (!ctx) {
        canvas.remove()
        return
    }

    const dpr = window.devicePixelRatio || 1
    const width = rect.width
    const height = rect.height
    canvas.width = Math.round(width * dpr)
    canvas.height = Math.round(height * dpr)
    ctx.scale(dpr, dpr)

    // Burst from the upper third, radiating outward and upward; gravity does the
    // rest. Index varies the seed so successive bursts never look identical.
    const originX = width / 2
    const originY = height * 0.32
    const particles: Particle[] = Array.from({ length: PARTICLE_COUNT }, (_, i) => {
        const angle = (i / PARTICLE_COUNT) * Math.PI * 2 + (i % 7) * 0.13
        const speed = 4 + ((i * 37) % 100) / 16
        return {
            x: originX,
            y: originY,
            vx: Math.cos(angle) * speed,
            vy: Math.sin(angle) * speed - 3,
            size: 5 + ((i * 13) % 5),
            color: COLORS[i % COLORS.length] ?? '#3b82f6',
            angle: (i % 12) * 0.5,
            spin: (((i % 5) - 2) * 0.2) / 2 + 0.05
        }
    })

    let start: number | null = null
    let raf = 0
    let done = false

    const dispose = (): void => {
        if (done) return
        done = true
        window.cancelAnimationFrame(raf)
        canvas.remove()
    }

    // Guaranteed cleanup independent of rAF: the browser throttles/pauses
    // requestAnimationFrame when the window isn't painting (background tab, focus
    // lost right after completing a note), which would otherwise freeze the burst
    // on screen forever. This timer always removes the canvas.
    const safety = window.setTimeout(dispose, DURATION_MS + 400)

    const frame = (now: number): void => {
        // The view was closed (or re-rendered away) — stop and let GC reclaim.
        if (done) return
        if (!canvas.isConnected) {
            dispose()
            return
        }
        if (start === null) start = now
        const elapsed = now - start
        const progress = elapsed / DURATION_MS

        ctx.clearRect(0, 0, width, height)
        // Fade the whole burst out over the back half of its life.
        ctx.globalAlpha = progress < 0.5 ? 1 : Math.max(0, 1 - (progress - 0.5) * 2)

        for (const p of particles) {
            p.vx *= DRAG
            p.vy = p.vy * DRAG + GRAVITY
            p.x += p.vx
            p.y += p.vy
            p.angle += p.spin

            ctx.save()
            ctx.translate(p.x, p.y)
            ctx.rotate(p.angle)
            ctx.fillStyle = p.color
            ctx.fillRect(-p.size / 2, -p.size / 2, p.size, p.size * 0.6)
            ctx.restore()
        }

        if (elapsed < DURATION_MS) {
            raf = window.requestAnimationFrame(frame)
        } else {
            window.clearTimeout(safety)
            dispose()
        }
    }

    raf = window.requestAnimationFrame(frame)
}
