import type { ComponentChildren } from 'preact';
import { Icon, type IconName } from './Icon';

/*
 * The designed loading, empty and error states every page uses instead of a bare line of text: an icon, a title and an
 * optional explanation or action. Errors are announced (role="alert"), loading and empty states politely.
 */

const ICONS: Record<'loading' | 'empty' | 'error', IconName> = { loading: 'refresh', empty: 'inbox', error: 'alert' };

export function StateMessage(props: { kind: 'loading' | 'empty' | 'error'; title: string; id?: string; icon?: IconName; compact?: boolean; children?: ComponentChildren }) {
  return (
    <div
      id={props.id}
      class={`state ${props.kind}${props.compact ? ' compact' : ''}`}
      role={props.kind === 'error' ? 'alert' : 'status'}
    >
      <span class="state-icon" aria-hidden="true">
        <Icon name={props.icon ?? ICONS[props.kind]} />
      </span>
      <span class="state-title">{props.title}</span>
      {props.children}
    </div>
  );
}
