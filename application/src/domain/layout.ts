export type Point = { x: number; y: number };
export const NODE_WIDTH = 320;
export const NODE_HEIGHT = 144;
export const defaultPosition = (index: number): Point => ({ x: 36 + (index % 4) * 368, y: 48 + Math.floor(index / 4) * 192 });
export const findFreePosition = (positions: Point[], preferred: Point): Point => {
  const point = { ...preferred };
  while (positions.some((p) => Math.abs(p.x - point.x) < NODE_WIDTH + 24 && Math.abs(p.y - point.y) < NODE_HEIGHT + 24)) point.y += 192;
  return point;
};
export const linkPath = (a: Point, b: Point, aHeight = NODE_HEIGHT, bHeight = NODE_HEIGHT): string => {
  const dx = b.x - a.x, dy = b.y + bHeight / 2 - a.y - aHeight / 2;
  const edge = (height: number) => {
    const ratio = Math.max(Math.abs(dx) / NODE_WIDTH, Math.abs(dy) / height);
    return ratio ? Math.min(0.5, 0.5 / ratio) : 0;
  };
  return `M ${a.x + NODE_WIDTH / 2 + dx * edge(aHeight)} ${a.y + aHeight / 2 + dy * edge(aHeight)} L ${b.x + NODE_WIDTH / 2 - dx * edge(bHeight)} ${b.y + bHeight / 2 - dy * edge(bHeight)}`;
};
