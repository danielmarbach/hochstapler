// Drawn icon set (docs/DESIGN.md #104): inline SVG instead of emoji, which look different on every OS and clash
// with the ink look of the stamps and postmarks. Same 2px ink stroke, hard corners, colour from the surrounding text.
// The icon itself is decoration: the control around it carries the accessible name.
import type { VNode } from "preact";

const SHAPES = {
  /** follow camera: photo camera with viewfinder and lens */
  camera: (
    <>
      <rect x="3" y="8" width="18" height="12" />
      <path d="M8 8 L10 4 H14 L16 8" />
      <circle cx="12" cy="14" r="3.5" />
    </>
  ),
  /** glow: a big and a small sparkle */
  glow: (
    <>
      <path d="M10 7 L11.9 12.1 L17 14 L11.9 15.9 L10 21 L8.1 15.9 L3 14 L8.1 12.1 Z" />
      <path d="M18 2.5 V9.5 M14.5 6 H21.5" />
    </>
  ),
  /** back to the start page */
  home: (
    <>
      <path d="M3 11 L12 3.5 L21 11" />
      <path d="M5.5 9.5 V20.5 H18.5 V9.5" />
      <path d="M10 20.5 V14.5 H14 V20.5" />
    </>
  ),
  /** game menu: three ink dots */
  menu: (
    <g fill="currentColor" stroke="none">
      <rect x="3" y="10" width="4" height="4" />
      <rect x="10" y="10" width="4" height="4" />
      <rect x="17" y="10" width="4" height="4" />
    </g>
  ),
  /** give up: a waving white flag on a pole */
  flag: (
    <>
      <path d="M5 3 V21" />
      <path d="M5 4.5 C8.5 2 12 6.5 19 4 V14 C12 16.5 8.5 12 5 14.5" />
    </>
  ),
  /** continue on another device */
  phone: (
    <>
      <rect x="7" y="2.5" width="10" height="19" />
      <path d="M7 18 H17" />
    </>
  ),
  /** get-out-of-jail card: a ticket with the perforation of the passport stamps */
  ticket: (
    <>
      <path d="M3 7 H21 V10.5 A1.5 1.5 0 0 0 21 13.5 V17 H3 V13.5 A1.5 1.5 0 0 0 3 10.5 Z" />
      <path d="M9 7 V17" stroke-dasharray="1.5 2.5" />
    </>
  ),
  /** custody and locked shares */
  lock: (
    <>
      <rect x="5" y="11" width="14" height="10" />
      <path d="M8 11 V7.5 A4 4 0 0 1 16 7.5 V11" />
      <rect x="11" y="14.5" width="2" height="3.5" fill="currentColor" stroke="none" />
    </>
  ),
  /** computer player */
  bot: (
    <>
      <rect x="4" y="8" width="16" height="12" />
      <path d="M12 8 V4 M2 12 V16 M22 12 V16 M9 17 H15" />
      <g fill="currentColor" stroke="none">
        <rect x="10.5" y="2" width="3" height="3" />
        <rect x="8" y="12" width="2.5" height="2.5" />
        <rect x="13.5" y="12" width="2.5" height="2.5" />
      </g>
    </>
  ),
} satisfies Record<string, VNode>;

export type IconName = keyof typeof SHAPES;

export const ICON_NAMES = Object.keys(SHAPES) as IconName[];

export function Icon({
  name,
  size = 20,
  class: className,
}: {
  name: IconName;
  size?: number;
  class?: string;
}): VNode {
  return (
    <svg
      class={className ? `ico ${className}` : "ico"}
      viewBox="0 0 24 24"
      width={size}
      height={size}
      fill="none"
      stroke="currentColor"
      stroke-width={2}
      stroke-linecap="square"
      stroke-linejoin="miter"
      aria-hidden="true"
      focusable="false"
    >
      {SHAPES[name]}
    </svg>
  );
}
