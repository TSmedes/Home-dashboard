/** The part of a DOMRect the expand animation needs. */
export interface Box {
  top: number;
  left: number;
  width: number;
  height: number;
}

const px = (value: number) => `${Math.round(Math.max(0, value) * 10) / 10}px`;

/**
 * A clip-path that trims the full-screen shell down to `box`, keeping the
 * tile's rounded corners. Animating from this to the unclipped shell is what
 * makes the card look like it grows out of its place on the grid, without
 * resizing anything and so without re-laying out what is inside it.
 */
export function clipInset(box: Box, shell: Box, radius: number): string {
  const top = box.top - shell.top;
  const left = box.left - shell.left;
  const right = shell.left + shell.width - (box.left + box.width);
  const bottom = shell.top + shell.height - (box.top + box.height);
  return `inset(${px(top)} ${px(right)} ${px(bottom)} ${px(left)} round ${radius}px)`;
}
