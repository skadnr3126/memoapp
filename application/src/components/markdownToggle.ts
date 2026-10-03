import { InputRule, Node } from "@tiptap/core";
import { TextSelection } from "@tiptap/pm/state";
import { Marked } from "marked";

function readToggle(src: string) {
  const opening = /^ {0,3}:::toggle(?:[ \t]+([^\n]*))?[ \t]*\n/.exec(src);
  if (!opening) return;
  let depth = 1;
  let offset = opening[0].length;
  let fence = "";
  for (const line of src.slice(offset).split(/(?<=\n)/)) {
    const marker = /^ {0,3}(`{3,}|~{3,})(.*)/.exec(line);
    if (fence) {
      if (marker && marker[1][0] === fence[0] && marker[1].length >= fence.length && !marker[2].trim()) fence = "";
    } else if (marker) {
      fence = marker[1];
    } else if (/^ {0,3}:::toggle(?:[ \t]|\r?\n|$)/.test(line)) {
      depth++;
    } else if (/^ {0,3}:::[ \t]*(?:\r?\n|$)/.test(line) && --depth === 0) {
      return { raw: src.slice(0, offset + line.length), title: opening[1]?.trim() ?? "", body: src.slice(opening[0].length, offset) };
    }
    offset += line.length;
  }
}

// Use the same syntax for paste detection and unsupported-content checks.
export const markdownLexer = new Marked({ extensions: [{
  name: "toggle",
  level: "block",
  childTokens: ["tokens", "titleTokens"],
  start: src => src.search(/^ {0,3}:::toggle(?:[ \t]|$)/m),
  tokenizer(src) {
    const toggle = readToggle(src);
    if (toggle) return {
      type: "toggle", raw: toggle.raw, text: toggle.title,
      tokens: this.lexer.blockTokens(toggle.body), titleTokens: this.lexer.inlineTokens(toggle.title),
    };
  },
}] });

export const ToggleTitle = Node.create({
  name: "toggleTitle",
  content: "inline*",
  parseHTML: () => [{ tag: "summary" }],
  renderHTML: () => ["summary", { class: "scription-toggle-title" }, 0],
  renderMarkdown: (node, helpers) => helpers.renderChildren(node.content ?? []),
});

export const ToggleBody = Node.create({
  name: "toggleBody",
  content: "block+",
  parseHTML: () => [{ tag: "div[data-toggle-body]" }],
  renderHTML: () => ["div", { "data-toggle-body": "", class: "scription-toggle-body" }, 0],
  renderMarkdown: (node, helpers) => helpers.renderChildren(node.content ?? [], "\n\n"),
});

export const Toggle = Node.create({
  name: "toggle",
  priority: 110,
  group: "block",
  content: "toggleTitle toggleBody",
  defining: true,
  parseHTML: () => [{ tag: "details" }],
  renderHTML: () => ["details", {}, 0],
  addInputRules() {
    return [new InputRule({
      find: /^> $/,
      handler: ({ state, range }) => {
        const $start = state.doc.resolve(range.from);
        if ($start.parent.type.name !== "paragraph" || !$start.node(-1).canReplaceWith($start.index(-1), $start.indexAfter(-1), this.type)) return null;
        const tr = state.tr.delete(range.from, range.to);
        const paragraph = tr.doc.resolve(range.from);
        const start = paragraph.before();
        tr.replaceWith(start, paragraph.after(), this.type.create(null, [
          state.schema.nodes.toggleTitle.create(null, paragraph.parent.content),
          state.schema.nodes.toggleBody.create(null, state.schema.nodes.paragraph.create()),
        ]));
        tr.setSelection(TextSelection.create(tr.doc, start + 2));
      },
    })];
  },
  addKeyboardShortcuts() {
    return {
      Enter: () => {
        const { $from } = this.editor.state.selection;
        if ($from.parent.type.name !== "toggleTitle") return false;
        const toggleStart = $from.before($from.depth - 1);
        const dom = this.editor.view.nodeDOM(toggleStart);
        if (dom instanceof HTMLElement) dom.querySelector<HTMLButtonElement>(':scope > button[aria-expanded="false"]')?.click();
        return this.editor.commands.setTextSelection($from.after() + 2);
      },
    };
  },
  markdownTokenizer: {
    name: "toggle",
    level: "block",
    start: src => src.search(/^ {0,3}:::toggle(?:[ \t]|$)/m),
    tokenize(src, _tokens, lexer) {
      const toggle = readToggle(src);
      if (toggle) return { type: "toggle", raw: toggle.raw, text: toggle.title, tokens: lexer.blockTokens(toggle.body) };
    },
  },
  parseMarkdown(token, helpers) {
    const title = token.text ?? "";
    const body = helpers.parseChildren(token.tokens ?? []);
    return helpers.createNode("toggle", undefined, [
      helpers.createNode("toggleTitle", undefined, helpers.parseInline(helpers.tokenizeInline?.(title) ?? [{ type: "text", text: title }])),
      helpers.createNode("toggleBody", undefined, body.length ? body : [{ type: "paragraph" }]),
    ]);
  },
  renderMarkdown(node, helpers) {
    const [title, body] = node.content ?? [];
    return `:::toggle ${title ? helpers.renderChildren(title) : ""}\n\n${body ? helpers.renderChildren(body, "\n\n") : ""}\n\n:::`;
  },
  addNodeView() {
    return () => {
      const dom = document.createElement("div");
      dom.className = "scription-toggle";
      const button = document.createElement("button");
      button.type = "button";
      button.contentEditable = "false";
      const contentDOM = document.createElement("div");
      const setOpen = (open: boolean) => {
        dom.classList.toggle("is-collapsed", !open);
        button.textContent = open ? "▾" : "▸";
        button.setAttribute("aria-expanded", String(open));
        button.setAttribute("aria-label", open ? "토글 접기" : "토글 펼치기");
      };
      setOpen(false);
      button.addEventListener("mousedown", event => event.preventDefault());
      button.addEventListener("click", () => setOpen(button.getAttribute("aria-expanded") !== "true"));
      dom.append(button, contentDOM);
      return {
        dom, contentDOM,
        stopEvent: event => event.target === button,
        ignoreMutation: mutation => mutation.type !== "selection" && (mutation.target === dom || button.contains(mutation.target)),
      };
    };
  },
});
