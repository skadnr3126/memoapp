export const BLOCK_COLORS = [
  { value: "red", label: "빨강", background: "#fbe4e3" },
  { value: "yellow", label: "노랑", background: "#fff2cc" },
  { value: "green", label: "초록", background: "#e2f0dc" },
  { value: "blue", label: "파랑", background: "#e0edfa" },
  { value: "purple", label: "보라", background: "#eee2f6" },
] as const;

export type BlockColor = typeof BLOCK_COLORS[number]["value"];
export const isBlockColor = (value: unknown): value is BlockColor => BLOCK_COLORS.some(color => color.value === value);
