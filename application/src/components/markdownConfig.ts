import StarterKit from "@tiptap/starter-kit";
import { Markdown } from "@tiptap/markdown";
import TaskList from "@tiptap/extension-task-list";
import TaskItem from "@tiptap/extension-task-item";
import { markdownLexer, Toggle, ToggleTitle, ToggleBody } from "./markdownToggle";

export const documentExtensions = () => [
  StarterKit.configure({ underline: false, link: { openOnClick: false }, trailingNode: false }),
  TaskList,
  TaskItem.configure({ nested: true }),
  Toggle,
  ToggleTitle,
  ToggleBody,
  Markdown,
];

// Keep unsupported structures in source mode instead of silently dropping them on edit.
export function requiresSource(markdown: string) {
  let unsupported = false;
  markdownLexer.walkTokens(markdownLexer.lexer(markdown), token => {
    if (["html", "image", "table"].includes(token.type)) unsupported = true;
  });
  return unsupported;
}
