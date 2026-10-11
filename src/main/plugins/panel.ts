import type { Panel, PanelNode } from '../../shared/plugins';

/*
 * Checks the panels plugins describe (#103) before the window draws them, and the interactions the window sends back
 * before the plugin hears about them. Everything has a type and a size limit, ids are simple and unique, and missing
 * optional fields get defaults, so the window only ever gets complete, plain data.
 */

// CHANGE HERE: panel limits.
export const PANEL_LIMITS = {
  maxNodes: 50,
  maxListItems: 100,
  maxOptions: 50,
  maxText: 500,
  maxLabel: 80,
  maxJsonBytes: 32 * 1024,
};

export class PanelError extends Error {
  override name = 'PanelError';
}

const ID = /^[A-Za-z0-9_-]{1,40}$/;
const NODE_TYPES = ['text', 'list', 'button', 'toggle', 'slider', 'select'];

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function str(value: unknown, field: string, max: number, optional = false): string {
  if (value === undefined && optional) return '';
  if (typeof value !== 'string' || value.length > max || (!optional && value.trim() === '')) throw new PanelError(`${field} must be text of ${optional ? 0 : 1} to ${max} characters.`);
  return value;
}

function num(value: unknown, field: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) throw new PanelError(`${field} must be a number.`);
  return value;
}

/** Checks one node and returns it complete. */
function node(raw: unknown, where: string, ids: Set<string>): PanelNode {
  if (!isObject(raw) || typeof raw['type'] !== 'string' || !NODE_TYPES.includes(raw['type'])) throw new PanelError(`${where} must have a type: ${NODE_TYPES.join(', ')}.`);
  const type = raw['type'];
  const id = (): string => {
    const value = raw['id'];
    if (typeof value !== 'string' || !ID.test(value)) throw new PanelError(`${where}: "id" must be 1 to 40 letters, digits, "_" or "-".`);
    if (ids.has(value)) throw new PanelError(`${where}: the id "${value}" is used twice.`);
    ids.add(value);
    return value;
  };
  const label = () => str(raw['label'], `${where}: "label"`, PANEL_LIMITS.maxLabel);
  switch (type) {
    case 'text': {
      const style = raw['style'] ?? 'normal';
      if (style !== 'heading' && style !== 'normal' && style !== 'muted') throw new PanelError(`${where}: "style" must be heading, normal or muted.`);
      return { type, text: str(raw['text'], `${where}: "text"`, PANEL_LIMITS.maxText), style };
    }
    case 'list': {
      const items = raw['items'];
      if (!Array.isArray(items) || items.length > PANEL_LIMITS.maxListItems) throw new PanelError(`${where}: "items" must be a list of at most ${PANEL_LIMITS.maxListItems}.`);
      return {
        type,
        items: items.map((item: unknown, i) => {
          if (typeof item === 'string') return { text: str(item, `${where} item ${i}`, PANEL_LIMITS.maxText), detail: '' };
          if (!isObject(item)) throw new PanelError(`${where} item ${i} must be text or { text, detail }.`);
          return { text: str(item['text'], `${where} item ${i}: "text"`, PANEL_LIMITS.maxText), detail: str(item['detail'], `${where} item ${i}: "detail"`, PANEL_LIMITS.maxLabel, true) };
        }),
      };
    }
    case 'button':
      return { type, id: id(), label: label() };
    case 'toggle': {
      const value = raw['value'] ?? false;
      if (typeof value !== 'boolean') throw new PanelError(`${where}: "value" must be true or false.`);
      return { type, id: id(), label: label(), value };
    }
    case 'slider': {
      const min = num(raw['min'] ?? 0, `${where}: "min"`);
      const max = num(raw['max'] ?? 100, `${where}: "max"`);
      const step = num(raw['step'] ?? 1, `${where}: "step"`);
      if (!(min < max) || !(step > 0) || step > max - min) throw new PanelError(`${where}: needs min < max and a step from above 0 up to max - min.`);
      const value = num(raw['value'] ?? min, `${where}: "value"`);
      if (value < min || value > max) throw new PanelError(`${where}: "value" must be from min to max.`);
      return { type, id: id(), label: label(), min, max, step, value };
    }
    default: {
      const options = raw['options'];
      if (!Array.isArray(options) || options.length === 0 || options.length > PANEL_LIMITS.maxOptions) throw new PanelError(`${where}: "options" must be a list of 1 to ${PANEL_LIMITS.maxOptions}.`);
      const parsed = options.map((o: unknown, i) => {
        if (typeof o === 'string') return { value: str(o, `${where} option ${i}`, PANEL_LIMITS.maxLabel), label: o };
        if (!isObject(o)) throw new PanelError(`${where} option ${i} must be text or { value, label }.`);
        return { value: str(o['value'], `${where} option ${i}: "value"`, PANEL_LIMITS.maxLabel), label: str(o['label'], `${where} option ${i}: "label"`, PANEL_LIMITS.maxLabel) };
      });
      if (new Set(parsed.map((o) => o.value)).size !== parsed.length) throw new PanelError(`${where}: option values must be different.`);
      const value = raw['value'] ?? parsed[0]?.value;
      if (typeof value !== 'string' || !parsed.some((o) => o.value === value)) throw new PanelError(`${where}: "value" must be one of the options.`);
      return { type: 'select', id: id(), label: label(), options: parsed, value };
    }
  }
}

/** Checks a panel description from a plugin; throws a PanelError saying what is wrong. */
export function parsePanel(raw: unknown): Panel {
  if (!isObject(raw)) throw new PanelError('The panel must be an object with "title" and "items".');
  if (Buffer.byteLength(JSON.stringify(raw)) > PANEL_LIMITS.maxJsonBytes) throw new PanelError(`The panel is larger than ${PANEL_LIMITS.maxJsonBytes / 1024} KB.`);
  const items = raw['items'];
  if (!Array.isArray(items) || items.length > PANEL_LIMITS.maxNodes) throw new PanelError(`"items" must be a list of at most ${PANEL_LIMITS.maxNodes}.`);
  const ids = new Set<string>();
  return { title: str(raw['title'], '"title"', PANEL_LIMITS.maxLabel, true), items: items.map((n: unknown, i) => node(n, `item ${i}`, ids)) };
}

/**
 * Checks an interaction from the window against the panel that was shown, and returns the value the plugin hears:
 * nothing for a button, true or false for a toggle, a number within range (on a step) for a slider, one of the options
 * for a select. Null when it does not match the panel (the window may have been a step behind).
 */
export function checkAction(panel: Panel, id: unknown, value: unknown): { id: string; value: boolean | number | string | null } | null {
  if (typeof id !== 'string') return null;
  const target = panel.items.find((n) => 'id' in n && n.id === id);
  if (!target) return null;
  switch (target.type) {
    case 'button':
      return { id, value: null };
    case 'toggle':
      return typeof value === 'boolean' ? { id, value } : null;
    case 'slider': {
      if (typeof value !== 'number' || !Number.isFinite(value) || value < target.min || value > target.max) return null;
      const steps = Math.round((value - target.min) / target.step);
      return { id, value: Math.min(target.max, target.min + steps * target.step) };
    }
    case 'select':
      return typeof value === 'string' && target.options.some((o) => o.value === value) ? { id, value } : null;
    default:
      return null;
  }
}
