import { describe, expect, test } from 'bun:test'
import { planReconcile, type KeyedSig } from './reconcile'

const sig = (key: string, signature = key): KeyedSig => ({ key, signature })

describe('planReconcile', () => {
    test('identical → reuse all, remove none', () => {
        const items = [sig('a'), sig('b'), sig('c')]
        const plan = planReconcile(items, items)
        expect(plan.remove).toEqual([])
        expect(plan.ordered).toEqual([
            { key: 'a', create: false, update: false },
            { key: 'b', create: false, update: false },
            { key: 'c', create: false, update: false }
        ])
    })

    test('insert a new key', () => {
        const plan = planReconcile([sig('a'), sig('b')], [sig('a'), sig('x'), sig('b')])
        expect(plan.remove).toEqual([])
        expect(plan.ordered.map((o) => `${o.key}:${String(o.create)}`)).toEqual([
            'a:false',
            'x:true',
            'b:false'
        ])
    })

    test('remove a gone key', () => {
        const plan = planReconcile([sig('a'), sig('b'), sig('c')], [sig('a'), sig('c')])
        expect(plan.remove).toEqual(['b'])
        expect(plan.ordered.map((o) => o.key)).toEqual(['a', 'c'])
    })

    test('reorder preserves nodes (no create/update/remove)', () => {
        const plan = planReconcile([sig('a'), sig('b'), sig('c')], [sig('c'), sig('a'), sig('b')])
        expect(plan.remove).toEqual([])
        expect(plan.ordered.every((o) => !o.create && !o.update)).toBe(true)
        expect(plan.ordered.map((o) => o.key)).toEqual(['c', 'a', 'b'])
    })

    test('signature change → update + remove old node', () => {
        const plan = planReconcile([sig('a', 'v1'), sig('b')], [sig('a', 'v2'), sig('b')])
        expect(plan.remove).toEqual(['a'])
        expect(plan.ordered).toEqual([
            { key: 'a', create: false, update: true },
            { key: 'b', create: false, update: false }
        ])
    })

    test('mixed insert/remove/update/reorder', () => {
        const existing = [sig('a', 'v1'), sig('b'), sig('c'), sig('d')]
        const desired = [sig('d'), sig('a', 'v2'), sig('e'), sig('b')] // c removed, e added, a changed
        const plan = planReconcile(existing, desired)
        expect(plan.remove.sort()).toEqual(['a', 'c']) // a changed, c gone (b,d reused)
        expect(plan.ordered).toEqual([
            { key: 'd', create: false, update: false },
            { key: 'a', create: false, update: true },
            { key: 'e', create: true, update: false },
            { key: 'b', create: false, update: false }
        ])
    })

    test('empty desired removes everything', () => {
        const plan = planReconcile([sig('a'), sig('b')], [])
        expect(plan.remove.sort()).toEqual(['a', 'b'])
        expect(plan.ordered).toEqual([])
    })

    test('empty existing creates everything', () => {
        const plan = planReconcile([], [sig('a'), sig('b')])
        expect(plan.remove).toEqual([])
        expect(plan.ordered.every((o) => o.create)).toBe(true)
    })
})
