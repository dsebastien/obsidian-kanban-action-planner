/**
 * Property value → card color (issue #150). Pure: no DOM, no Obsidian.
 *
 * A board can color its cards by any property (`cardColorProperty`). The value
 * resolves to a CSS color expression, in this order:
 *
 * 1. the value IS a CSS color (`#rgb`, `#rrggbb`, `rgb()`, `hsl()`, a named
 *    color) → used as is, so a formula can compute colors. The eight basic hue
 *    names map to Obsidian's theme variables (`red` → `var(--color-red)`);
 * 2. the value ranks on the property's enum scale (an `NN - Label` value with
 *    known allowed values, see `heatLevel`) → the heat color of its rank, the
 *    same scale the field chips use (warm = top, cool = bottom);
 * 3. otherwise → a stable palette color picked by hashing the value, from the
 *    theme's `--color-*` variables, so it reads in light and dark themes.
 *
 * Lists use their first usable value; an empty value yields no color.
 */

/** Heat bucket (0 warmest … 4 coolest) → color, matching the field-chip heat scale. */
export const HEAT_COLORS: ReadonlyArray<string> = [
    'var(--color-red)',
    'var(--color-orange)',
    'var(--color-yellow)',
    'var(--color-blue)',
    'var(--text-muted)'
]

/** Theme hues for hashed values, in a fixed order (changing it recolors boards). */
export const PALETTE_HUES: ReadonlyArray<string> = [
    'red',
    'orange',
    'yellow',
    'green',
    'cyan',
    'blue',
    'purple',
    'pink'
]

const PALETTE_COLORS: ReadonlyArray<string> = PALETTE_HUES.map((hue) => `var(--color-${hue})`)

/** CSS named colors (CSS Color 4), lowercase. `transparent` / `currentcolor` excluded. */
const NAMED_COLORS: ReadonlySet<string> = new Set(
    (
        'aliceblue antiquewhite aqua aquamarine azure beige bisque black blanchedalmond blue ' +
        'blueviolet brown burlywood cadetblue chartreuse chocolate coral cornflowerblue cornsilk ' +
        'crimson cyan darkblue darkcyan darkgoldenrod darkgray darkgreen darkgrey darkkhaki ' +
        'darkmagenta darkolivegreen darkorange darkorchid darkred darksalmon darkseagreen ' +
        'darkslateblue darkslategray darkslategrey darkturquoise darkviolet deeppink deepskyblue ' +
        'dimgray dimgrey dodgerblue firebrick floralwhite forestgreen fuchsia gainsboro ' +
        'ghostwhite gold goldenrod gray green greenyellow grey honeydew hotpink indianred indigo ' +
        'ivory khaki lavender lavenderblush lawngreen lemonchiffon lightblue lightcoral ' +
        'lightcyan lightgoldenrodyellow lightgray lightgreen lightgrey lightpink lightsalmon ' +
        'lightseagreen lightskyblue lightslategray lightslategrey lightsteelblue lightyellow lime ' +
        'limegreen linen magenta maroon mediumaquamarine mediumblue mediumorchid mediumpurple ' +
        'mediumseagreen mediumslateblue mediumspringgreen mediumturquoise mediumvioletred ' +
        'midnightblue mintcream mistyrose moccasin navajowhite navy oldlace olive olivedrab ' +
        'orange orangered orchid palegoldenrod palegreen paleturquoise palevioletred papayawhip ' +
        'peachpuff peru pink plum powderblue purple rebeccapurple red rosybrown royalblue ' +
        'saddlebrown salmon sandybrown seagreen seashell sienna silver skyblue slateblue ' +
        'slategray slategrey snow springgreen steelblue tan teal thistle tomato turquoise violet ' +
        'wheat white whitesmoke yellow yellowgreen'
    ).split(' ')
)

const HEX_COLOR = /^#(?:[0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/i
/**
 * Functional notations. The argument allows only digits, signs, dots, commas,
 * `%`, `/`, spaces and letters (units such as `deg`, the keyword `none`): no
 * parentheses, quotes or semicolons, so nothing but a color can get through.
 */
const FUNCTIONAL_COLOR = /^(?:rgba?|hsla?|hwb|lab|lch|oklab|oklch)\(\s*[-+0-9.,%/\sa-z]+\)$/i

/**
 * The value as a CSS color expression, or null when it is not a color. Basic
 * hue names resolve to the theme's variable for that hue.
 */
export function cssColorLiteral(text: string): string | null {
    const t = text.trim()
    if (HEX_COLOR.test(t) || FUNCTIONAL_COLOR.test(t)) return t
    const name = t.toLowerCase()
    if (PALETTE_HUES.includes(name)) return `var(--color-${name})`
    return NAMED_COLORS.has(name) ? name : null
}

/** First usable text of a raw frontmatter / Bases value (lists → first usable item). */
export function firstColorText(raw: unknown): string | null {
    if (Array.isArray(raw)) {
        for (const item of raw) {
            const text = firstColorText(item)
            if (text !== null) return text
        }
        return null
    }
    if (typeof raw === 'number' || typeof raw === 'boolean') return String(raw)
    if (typeof raw !== 'string') return null
    const text = raw.trim()
    // A Bases `NullValue` stringifies as "null".
    return text === '' || text === 'null' ? null : text
}

/**
 * The identity of a value for hashing: a wikilink counts by its target, so
 * `[[Project X]]` and `[[Project X|PX]]` share a color, and case is ignored.
 */
export function colorKey(text: string): string {
    const wiki = /^!?\[\[([^\]|#]*)[^\]]*\]\]$/.exec(text.trim())
    const target = wiki?.[1] !== undefined ? wiki[1] : text
    return target.trim().toLowerCase()
}

/** 32-bit FNV-1a hash (stable across sessions and platforms). */
function fnv1a(text: string): number {
    let hash = 0x811c9dc5
    for (let i = 0; i < text.length; i++) {
        hash ^= text.charCodeAt(i)
        hash = Math.imul(hash, 0x01000193) >>> 0
    }
    return hash
}

/** The palette color a value hashes to (stable per distinct value). */
export function paletteColor(text: string): string {
    const index = fnv1a(colorKey(text)) % PALETTE_COLORS.length
    return PALETTE_COLORS[index] ?? 'var(--color-blue)'
}

/**
 * Resolve a property value to a CSS color expression (see the module comment
 * for the order), or null when the value is empty. `heatOf` ranks a value on
 * the property's enum scale (null = not an enum value).
 */
export function resolveValueColor(
    raw: unknown,
    heatOf: (text: string) => number | null = () => null
): string | null {
    const text = firstColorText(raw)
    if (text === null) return null
    const literal = cssColorLiteral(text)
    if (literal !== null) return literal
    const heat = heatOf(text)
    if (heat !== null) return HEAT_COLORS[heat] ?? null
    return paletteColor(text)
}
