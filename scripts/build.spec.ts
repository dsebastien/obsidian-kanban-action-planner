import { describe, expect, test } from 'bun:test'
import {
    ASSETS_SRC,
    BANNER,
    DIST,
    EXTERNAL_MODULES,
    PLUGIN_ID,
    SRC,
    STYLES_OUT,
    STYLES_SRC
} from './build'

describe('build constants', () => {
    test('SRC is set to src', () => {
        expect(SRC).toBe('src')
    })

    test('DIST is set to dist', () => {
        expect(DIST).toBe('dist')
    })

    test('ASSETS_SRC is set to src/assets', () => {
        expect(ASSETS_SRC).toBe('src/assets')
    })

    test('STYLES_SRC is set to src/styles.src.css', () => {
        expect(STYLES_SRC).toBe('src/styles.src.css')
    })

    test('STYLES_OUT is set to dist/styles.css', () => {
        expect(STYLES_OUT).toBe('dist/styles.css')
    })

    test('PLUGIN_ID matches the manifest id', async () => {
        const manifestJson = (await Bun.file('manifest.json').json()) as { id: string }
        expect(PLUGIN_ID).toBe(manifestJson.id)
    })

    test('BANNER contains expected text', () => {
        expect(BANNER).toContain('GENERATED/BUNDLED FILE BY BUN')
        expect(BANNER).toContain('github repository')
    })
})

describe('EXTERNAL_MODULES', () => {
    test('includes obsidian', () => {
        expect(EXTERNAL_MODULES).toContain('obsidian')
    })

    test('includes electron', () => {
        expect(EXTERNAL_MODULES).toContain('electron')
    })

    test('includes codemirror modules', () => {
        expect(EXTERNAL_MODULES).toContain('@codemirror/autocomplete')
        expect(EXTERNAL_MODULES).toContain('@codemirror/state')
        expect(EXTERNAL_MODULES).toContain('@codemirror/view')
    })

    test('includes lezer modules', () => {
        expect(EXTERNAL_MODULES).toContain('@lezer/common')
        expect(EXTERNAL_MODULES).toContain('@lezer/highlight')
        expect(EXTERNAL_MODULES).toContain('@lezer/lr')
    })

    test('has expected number of external modules', () => {
        expect(EXTERNAL_MODULES.length).toBe(13)
    })
})

describe('readChangelogDefine', () => {
    test('inlines CHANGELOG.md as a JSON string literal', async () => {
        const { readChangelogDefine } = await import('./build')
        const define = await readChangelogDefine()
        const changelog = await Bun.file('CHANGELOG.md').text()
        // The value is substituted verbatim into source, so it must be a JSON
        // string literal that parses back to the exact file content. This is
        // the catalog-build fix: the reviewer's older Bun cannot parse the
        // markdown import attribute this replaced.
        expect(JSON.parse(define['__PLUGIN_CHANGELOG__'] ?? '')).toBe(changelog)
    })

    test('falls back to an empty string when CHANGELOG.md is missing', async () => {
        const { readChangelogDefine } = await import('./build')
        const previousCwd = process.cwd()
        const dir = `${previousCwd}/dist/.changelog-define-test`
        await Bun.$`mkdir -p ${dir}`.quiet()
        try {
            process.chdir(dir)
            const define = await readChangelogDefine()
            expect(define['__PLUGIN_CHANGELOG__']).toBe('""')
        } finally {
            process.chdir(previousCwd)
            await Bun.$`rm -rf ${dir}`.quiet()
        }
    })
})
