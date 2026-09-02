const SIDEBAR_MIN_WIDTH = 8;
const SIDEBAR_MAX_WIDTH = 480;

export const clampSidebarWidth = (width: number) =>
  Math.max(SIDEBAR_MIN_WIDTH, Math.min(SIDEBAR_MAX_WIDTH, width));
