import { describe, expect, it } from 'vitest';
import { PANEL_LIMITS, PanelError, checkAction, parsePanel } from '../src/main/plugins/panel';

describe('parsePanel', () => {
  it('accepts every node type and fills in the defaults', () => {
    const panel = parsePanel({
      title: 'Stats',
      items: [
        { type: 'text', text: 'Top artists', style: 'heading' },
        { type: 'text', text: 'plain' },
        { type: 'list', items: ['One', { text: 'Two', detail: '12 plays' }] },
        { type: 'button', id: 'refresh', label: 'Refresh' },
        { type: 'toggle', id: 'on', label: 'Enabled' },
        { type: 'slider', id: 'count', label: 'Songs', min: 5, max: 50, step: 5, value: 20 },
        { type: 'slider', id: 'plain-slider', label: 'Plain' },
        { type: 'select', id: 'preset', label: 'Preset', options: ['flat', { value: 'bassBoost', label: 'Bass boost' }], value: 'bassBoost' },
      ],
    });

    expect(panel.items).toEqual([
      { type: 'text', text: 'Top artists', style: 'heading' },
      { type: 'text', text: 'plain', style: 'normal' },
      { type: 'list', items: [{ text: 'One', detail: '' }, { text: 'Two', detail: '12 plays' }] },
      { type: 'button', id: 'refresh', label: 'Refresh' },
      { type: 'toggle', id: 'on', label: 'Enabled', value: false },
      { type: 'slider', id: 'count', label: 'Songs', min: 5, max: 50, step: 5, value: 20 },
      { type: 'slider', id: 'plain-slider', label: 'Plain', min: 0, max: 100, step: 1, value: 0 },
      { type: 'select', id: 'preset', label: 'Preset', options: [{ value: 'flat', label: 'flat' }, { value: 'bassBoost', label: 'Bass boost' }], value: 'bassBoost' },
    ]);
    expect(parsePanel({ items: [] })).toEqual({ title: '', items: [] });
  });

  it.each([
    [{ items: [{ type: 'html', html: '<b>x</b>' }] }, /must have a type/],
    [{ items: [{ type: 'script' }] }, /must have a type/],
    [{ items: [{ type: 'button', id: 'a b', label: 'x' }] }, /"id" must be/],
    [{ items: [{ type: 'button', id: 'a', label: 'x' }, { type: 'toggle', id: 'a', label: 'y' }] }, /used twice/],
    [{ items: [{ type: 'button', id: 'a', label: '' }] }, /"label"/],
    [{ items: [{ type: 'text', text: 'x'.repeat(PANEL_LIMITS.maxText + 1) }] }, /"text"/],
    [{ items: [{ type: 'text', text: 'x', style: 'blink' }] }, /"style"/],
    [{ items: [{ type: 'toggle', id: 't', label: 'x', value: 'yes' }] }, /true or false/],
    [{ items: [{ type: 'slider', id: 's', label: 'x', min: 10, max: 5 }] }, /min < max/],
    [{ items: [{ type: 'slider', id: 's', label: 'x', value: 500 }] }, /from min to max/],
    [{ items: [{ type: 'slider', id: 's', label: 'x', step: 0 }] }, /step/],
    [{ items: [{ type: 'slider', id: 's', label: 'x', min: Number.NaN }] }, /number/],
    [{ items: [{ type: 'select', id: 's', label: 'x', options: [] }] }, /"options"/],
    [{ items: [{ type: 'select', id: 's', label: 'x', options: ['a', 'a'] }] }, /different/],
    [{ items: [{ type: 'select', id: 's', label: 'x', options: ['a'], value: 'b' }] }, /one of the options/],
    [{ items: Array(PANEL_LIMITS.maxNodes + 1).fill({ type: 'text', text: 'x' }) }, /at most/],
    [{ items: [{ type: 'list', items: Array(PANEL_LIMITS.maxListItems + 1).fill('x') }] }, /at most/],
    [{ items: [{ type: 'list', items: Array(100).fill('y'.repeat(400)) }] }, /larger than/],
    [{ title: 42, items: [] }, /"title"/],
    [[], /must be an object/],
    ['panel', /must be an object/],
  ])('refuses %j', (raw, message) => {
    expect(() => parsePanel(raw)).toThrow(PanelError);
    expect(() => parsePanel(raw)).toThrow(message);
  });
});

describe('checkAction', () => {
  const panel = parsePanel({
    items: [
      { type: 'text', text: 'not interactive' },
      { type: 'button', id: 'go', label: 'Go' },
      { type: 'toggle', id: 'on', label: 'On' },
      { type: 'slider', id: 'n', label: 'N', min: 0, max: 10, step: 2 },
      { type: 'select', id: 'p', label: 'P', options: ['a', 'b'] },
    ],
  });

  it('passes on what matches the panel, with the value the plugin hears', () => {
    expect(checkAction(panel, 'go', 'ignored')).toEqual({ id: 'go', value: null });
    expect(checkAction(panel, 'on', true)).toEqual({ id: 'on', value: true });
    expect(checkAction(panel, 'n', 5)).toEqual({ id: 'n', value: 6 });
    expect(checkAction(panel, 'n', 10)).toEqual({ id: 'n', value: 10 });
    expect(checkAction(panel, 'p', 'b')).toEqual({ id: 'p', value: 'b' });
  });

  it('drops anything that does not match', () => {
    expect(checkAction(panel, 'missing', null)).toBeNull();
    expect(checkAction(panel, 42, null)).toBeNull();
    expect(checkAction(panel, 'on', 'true')).toBeNull();
    expect(checkAction(panel, 'n', 11)).toBeNull();
    expect(checkAction(panel, 'n', Number.POSITIVE_INFINITY)).toBeNull();
    expect(checkAction(panel, 'p', 'c')).toBeNull();
  });
});
