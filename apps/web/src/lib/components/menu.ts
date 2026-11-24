import type { ComponentProps } from 'svelte';
import type Icon from './Icon.svelte';

export type IconName = ComponentProps<typeof Icon>['name'];

export interface MenuItem {
  label: string;
  icon: IconName;
  href?: string;
  onclick?: () => void;
}
