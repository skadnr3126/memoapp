export type Point = { x: number; y: number; width?: number; height?: number };
export type ResizeCorner = "nw" | "ne" | "sw" | "se";
export const resizeNode = (rect: Required<Point>, corner: ResizeCorner, dx: number, dy: number): Required<Point> => {
  const width = Math.max(80, rect.width + (corner.includes("w") ? -dx : dx));
  const height = Math.max(72, rect.height + (corner.includes("n") ? -dy : dy));
  return { x: rect.x + (corner.includes("w") ? rect.width - width : 0), y: rect.y + (corner.includes("n") ? rect.height - height : 0), width, height };
};
export const NODE_WIDTH = 320;
export const NODE_HEIGHT = 144;
export const defaultPosition = (index: number): Point => ({ x: 36 + (index % 4) * 368, y: 48 + Math.floor(index / 4) * 192 });
export const findFreePosition = (positions: Point[], preferred: Point): Point => {
  const point = { ...preferred };
  while (positions.some((p) => point.x < p.x + (p.width ?? NODE_WIDTH) + 24 && point.x + (point.width ?? NODE_WIDTH) + 24 > p.x && point.y < p.y + (p.height ?? NODE_HEIGHT) + 24 && point.y + (point.height ?? NODE_HEIGHT) + 24 > p.y)) point.y += 192;
  return point;
};
export const linkPath = (a: Point, b: Point, aHeight = NODE_HEIGHT, bHeight = NODE_HEIGHT): string => {
  const aw = a.width ?? NODE_WIDTH, bw = b.width ?? NODE_WIDTH;
  const dx = b.x + bw / 2 - a.x - aw / 2, dy = b.y + bHeight / 2 - a.y - aHeight / 2;
  const edge = (width: number, height: number) => {
    const ratio = Math.max(Math.abs(dx) / width, Math.abs(dy) / height);
    return ratio ? Math.min(0.5, 0.5 / ratio) : 0;
  };
  return `M ${a.x + aw / 2 + dx * edge(aw, aHeight)} ${a.y + aHeight / 2 + dy * edge(aw, aHeight)} L ${b.x + bw / 2 - dx * edge(bw, bHeight)} ${b.y + bHeight / 2 - dy * edge(bw, bHeight)}`;
};
