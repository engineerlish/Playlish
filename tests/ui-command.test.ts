import { describe, expect, it } from 'vitest';
import { parseUiCommand } from '../src/main/ui-command';

describe('parseUiCommand', () => {
  it.each([
    [{ type: 'toggle' }, { type: 'toggle' }],
    [{ type: 'next', extra: 'dropped' }, { type: 'next' }],
    [{ type: 'volume', value: 0.4 }, { type: 'volume', value: 0.4 }],
    [{ type: 'seek', positionMs: 1234.7 }, { type: 'seek', positionMs: 1234 }],
    [{ type: 'mute', muted: true }, { type: 'mute', muted: true }],
    [{ type: 'shuffle', on: false }, { type: 'shuffle', on: false }],
    [{ type: 'repeat', mode: 'track' }, { type: 'repeat', mode: 'track' }],
  ])('accepts %j', (input, expected) => {
    expect(parseUiCommand(input)).toEqual(expected);
  });

  it.each([
    [null],
    ['toggle'],
    [{ type: 'eject' }],
    [{ type: 'volume', value: 5 }],
    [{ type: 'volume', value: -0.1 }],
    [{ type: 'volume', value: '0.5' }],
    [{ type: 'seek', positionMs: Number.NaN }],
    [{ type: 'seek', positionMs: -1 }],
    [{ type: 'seek', positionMs: Number.POSITIVE_INFINITY }],
    [{ type: 'mute', muted: 'yes' }],
    [{ type: 'shuffle' }],
    [{ type: 'repeat', mode: 'forever' }],
  ])('refuses %j', (input) => {
    expect(parseUiCommand(input)).toBeNull();
  });
});
