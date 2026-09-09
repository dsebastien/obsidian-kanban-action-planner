import { describe, expect, test } from 'bun:test'
import { weekPropertiesForType } from './week-properties.service'

const settings = {
    defaultTimeBlocksProperty: 'time_blocks',
    defaultPlannedMinutesProperty: 'minutes_planned_per_week',
    defaultTargetMinutesProperty: 'minutes_per_week',
    defaultAlarmMinutesProperty: 'minutes_alarm_per_week'
}

describe('weekPropertiesForType (issue #172, phase C)', () => {
    test('an untyped note and a type without overrides use the globals', () => {
        const globals = {
            timeBlocks: 'time_blocks',
            plannedMinutes: 'minutes_planned_per_week',
            targetMinutes: 'minutes_per_week',
            alarmMinutes: 'minutes_alarm_per_week'
        }
        expect(weekPropertiesForType(settings, undefined)).toEqual(globals)
        expect(weekPropertiesForType(settings, {})).toEqual(globals)
    })

    test('a non-blank override wins per field; blanks fall back', () => {
        const props = weekPropertiesForType(settings, {
            weekPlanner: {
                timeBlocksProperty: ' blocks ',
                plannedMinutesProperty: '',
                targetMinutesProperty: 'budget',
                alarmMinutesProperty: '   '
            }
        })
        expect(props).toEqual({
            timeBlocks: 'blocks',
            plannedMinutes: 'minutes_planned_per_week',
            targetMinutes: 'budget',
            alarmMinutes: 'minutes_alarm_per_week'
        })
    })
})
