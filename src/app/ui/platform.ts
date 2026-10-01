/**
 * Platform-keyed layout hooks (issue #194).
 *
 * Layouts key off Obsidian's `Platform` flags rather than the viewport width
 * alone: a narrow desktop pane is not a phone, and a tablet in landscape is
 * wider than many laptops. The flags become classes on `.kap-root`; the
 * stylesheet does the rest, with `@media` width queries still driving the
 * finer breakpoints.
 */

import { Platform } from 'obsidian'

export interface PlatformFlags {
    isMobile: boolean
    isPhone: boolean
    isTablet: boolean
}

/** Root class on every mobile device (phone or tablet). */
export const MOBILE_CLASS = 'kap-mobile'
/** Root class on phones: one column at a time on the board. */
export const PHONE_CLASS = 'kap-phone'
/** Root class on tablets: full board, finger-sized targets. */
export const TABLET_CLASS = 'kap-tablet'

/** The `.kap-root` classes for a platform. Desktop gets none. */
export function platformClasses(flags: PlatformFlags): string[] {
    if (!flags.isMobile) return []
    const classes = [MOBILE_CLASS]
    if (flags.isPhone) classes.push(PHONE_CLASS)
    else if (flags.isTablet) classes.push(TABLET_CLASS)
    return classes
}

/** The running app's platform flags. */
export function currentPlatform(): PlatformFlags {
    return {
        isMobile: Platform.isMobile,
        isPhone: Platform.isPhone,
        isTablet: Platform.isTablet
    }
}
