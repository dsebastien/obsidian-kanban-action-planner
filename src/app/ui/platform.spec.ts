import { test, expect, describe } from 'bun:test'
import { platformClasses } from './platform'

describe('platformClasses', () => {
    test('desktop gets no class', () => {
        expect(platformClasses({ isMobile: false, isPhone: false, isTablet: false })).toEqual([])
    })

    test('a phone is mobile and phone', () => {
        expect(platformClasses({ isMobile: true, isPhone: true, isTablet: false })).toEqual([
            'kap-mobile',
            'kap-phone'
        ])
    })

    test('a tablet is mobile and tablet', () => {
        expect(platformClasses({ isMobile: true, isPhone: false, isTablet: true })).toEqual([
            'kap-mobile',
            'kap-tablet'
        ])
    })

    test('mobile with neither size flag is just mobile', () => {
        expect(platformClasses({ isMobile: true, isPhone: false, isTablet: false })).toEqual([
            'kap-mobile'
        ])
    })

    test('the size flags are ignored off mobile', () => {
        expect(platformClasses({ isMobile: false, isPhone: true, isTablet: false })).toEqual([])
    })
})
