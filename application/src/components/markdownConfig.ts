import StarterKit from "@tiptap/starter-kit";
import { Markdown } from "@tiptap/markdown";
import TaskList from "@tiptap/extension-task-list";
import TaskItem from "@tiptap/extension-task-item";
import { marked } from "marked";

export const documentExtensions = () => [
  StarterKit.configure({ underline: false, link: { openOnClick: false }, trailingNode: false }),
  TaskList,
  TaskItem.configure({ nested: true }),
  Markdown,
];

// Keep unsupported structures in source mode instead of silently dropping them on edit.
export function requiresSource(markdown: string) {
  let unsupported = false;
  marked.walkTokens(marked.lexer(markdown), token => {
    if (["html", "image", "table"].includes(token.type)) unsupported = true;
  });
  return unsupported;
}
