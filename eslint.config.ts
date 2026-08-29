import eslint from '@eslint/js'
import tseslint from 'typescript-eslint'
import eslintConfigPrettier from 'eslint-config-prettier'
import globals from 'globals'
import obsidianmd from 'eslint-plugin-obsidianmd'
import { defineConfig } from 'eslint/config'

export default defineConfig([
    eslint.configs.recommended,
    ...tseslint.configs.recommended,
    // eslint-plugin-obsidianmd 0.4.x ships complete config types, so the
    // `@ts-expect-error` this line used to carry is no longer needed.
    ...obsidianmd.configs['recommended'],
    eslintConfigPrettier,
    {
        ignores: [
            '**/dist/**',
            '**/node_modules/**',
            'scripts/**',
            '.cz-config.cjs',
            'prettier.config.cjs',
            'package.json'
        ]
    },
    {
        // The declarative settings API port is deliberately deferred: this is
        // the fleet's largest settings surface and the plugin is under active
        // feature development, so the port gets its own pass rather than
        // racing the next feature branch. Re-enable when it lands.
        files: ['src/app/settings/settings-tab.ts'],
        rules: {
            'obsidianmd/settings-tab/prefer-setting-definitions': 'off'
        }
    },
    {
        // Specs and the test harness run under `bun test`, are never bundled
        // into the plugin, and are not scanned by the community scorecard, so
        // the mobile-compatibility and DOM-safety rules do not apply to them.
        // The preset forbids inline disables of these rules, so the exemption
        // lives here.
        files: ['**/*.spec.ts', 'src/test-setup.ts', 'src/test/**'],
        rules: {
            'obsidianmd/no-nodejs-modules': 'off',
            'obsidianmd/no-global-this': 'off',
            'obsidianmd/prefer-window-timers': 'off',
            'obsidianmd/no-tfile-tfolder-cast': 'off',
            'obsidianmd/no-static-styles-assignment': 'off'
        }
    },
    {
        files: ['**/*.{js,mjs,cjs,ts}'],
        languageOptions: {
            globals: {
                ...globals.node,
                ...globals.browser,
                // Obsidian global functions
                createDiv: 'readonly',
                createEl: 'readonly',
                createSpan: 'readonly',
                createFragment: 'readonly',
                // Obsidian popout-window-aware globals
                activeWindow: 'readonly',
                activeDocument: 'readonly'
            },
            parserOptions: {
                projectService: true,
                tsconfigRootDir: import.meta.dirname
            }
        },
        rules: {
            '@typescript-eslint/no-require-imports': 'off',
            // The community-plugin reviewer treats both the rule violation
            // and any `eslint-disable @typescript-eslint/no-explicit-any` as
            // an ERROR that blocks the scorecard. Catch locally as error,
            // not warn. See AGENTS.md "Community catalog review".
            '@typescript-eslint/no-explicit-any': 'error',
            '@typescript-eslint/no-unused-vars': [
                'error',
                { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }
            ],
            '@typescript-eslint/ban-ts-comment': 'off',
            '@typescript-eslint/no-deprecated': 'off',
            // These are too strict for dynamic plugin APIs
            '@typescript-eslint/no-unsafe-call': 'off',
            '@typescript-eslint/no-unsafe-member-access': 'off',
            '@typescript-eslint/no-unsafe-assignment': 'off',
            // Obsidian methods are dynamically added to prototypes
            '@typescript-eslint/no-unsafe-enum-comparison': 'off',
            'no-prototype-builtins': 'off',
            // Allow confirm for delete confirmations
            'no-alert': 'off',
            // Disable sentence case rule - it has false positives for already-correct text
            // Sentence case is a community-review requirement, so the rule is an
            // ERROR here rather than off. The catalog reviewer runs its OWN
            // ruleset against the source archive, so switching it off locally
            // suppresses nothing on their side. `brands` REPLACES the plugin's
            // default list; `ignoreRegex` entries are anchored to the exact
            // literals they exempt.
            'obsidianmd/ui/sentence-case': [
                'error',
                {
                    enforceCamelCaseLower: true,
                    brands: [
                        // Defaults this codebase relies on
                        'Obsidian',
                        'iOS',
                        'macOS',
                        'Windows',
                        'Linux',
                        'Android',
                        'GitHub',
                        'GitHub Sponsors',
                        'Git',
                        'YouTube',
                        'Markdown',
                        'JavaScript',
                        'TypeScript',
                        'Node.js',
                        // The follow CTA links to x.com
                        'X',
                        // Obsidian features and plugins this copy names
                        'Base',
                        'Bases',
                        'Canvas',
                        'Excalidraw',
                        'Dataview',
                        'TaskNotes',
                        // The companion plugin whose note types this one reads
                        'Starter Kit',
                        // Community this plugin's support CTAs link to
                        'Knowii'
                    ],
                    // Tokens that must keep their exact casing wherever they
                    // appear: this plugin's own vocabulary (WBS, WIP) and the
                    // key names its shortcut hints spell out. `acronyms`
                    // REPLACES the rule's defaults exactly like `brands`, so
                    // everything this codebase relies on is listed.
                    acronyms: [
                        'WBS',
                        'GTD',
                        'WIP',
                        'TBD',
                        'API',
                        'URL',
                        'CSS',
                        'HTML',
                        'JSON',
                        'YAML',
                        'UI',
                        'ID'
                    ],
                    ignoreRegex: [
                        // Author credit / handle — proper noun
                        '^@dSebastien$',
                        '^Sébastien Dubois \\(@dSebastien\\)$',
                        // Keyboard hints: the key names keep their own casing
                        '^Exit column triage \\(Esc\\)$',
                        '^Exit focus \\(Esc\\)$',
                        '^Open note \\(O\\)$',
                        '^Mark done and advance \\(D\\)$',
                        '^Keep here and advance \\(↓ or Space\\)$',
                        '^Enter saves \\(empty clears\\), Esc cancels$',
                        // Navigation label with a chevron
                        '^‹ Back$',
                        // The rule reads "e.g." as a sentence end and wants the
                        // example capitalised; these are literal example values
                        '^Frontmatter property name \\(e\\.g\\. priority, urgency, effort\\)\\.$',
                        '^Values that count as unset \\(e\\.g\\. TBD, No Target\\), beyond empty/invalid\\.$',
                        // Literal tags, lowercase by definition
                        '^#task, #action$',
                        // Multi-line placeholders showing sample status and
                        // priority VALUES: each line is a value the user
                        // types verbatim, not a sentence
                        '^10 Todo\\n20 In progress\\n30 Done$',
                        '^80 - Done\\n60 - Completed$',
                        '^10 - Top\\n20 - High\\n…$',
                        // Query-language placeholder: the operators and the
                        // sample values are syntax, not prose
                        '^Filter… e\\.g\\. book parent:"PKM" status:active OR overdue$',
                        // Quote UI paths the user should follow, so the labels
                        // keep the casing they actually have on screen
                        '^No archive folder configured for this note type\\. Set one in Configure board → Archiving\\.$',
                        '^Default grouping for boards of this type \\(note type or a property value\\)\\. A single board can override this in Configure view → Swimlanes\\.$',
                        // "(incl. nested)" — the rule reads the abbreviation's
                        // period as a sentence end and wants "Nested"
                        '^A note is this type when any rule matches — by tag \\(incl\\. nested\\), folder \\(and subfolders\\), or a regular expression on the note path\\.$',
                        // Same "e.g." parse on these two placeholders
                        '^Property \\(e\\.g\\. progress\\)$',
                        '^Tag \\(e\\.g\\. done\\)$',
                        // Fleet-wide template copy, kept byte-identical across
                        // every plugin. The catalog reviewer's own ruleset WILL
                        // report this line (it reads the phrase as ordinary
                        // prose); changing it here alone would break that
                        // invariant, so the wording is decided once in
                        // obsidian-plugin-template and ported.
                        '^Obsidian, Personal Knowledge Management and note-taking, straight to your inbox and feed\\.$'
                    ]
                }
            ]
        }
    }
])
