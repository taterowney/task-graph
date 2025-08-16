// Credit to the CodeMirror Rich Markdown Editor devs (https://github.com/segphault/codemirror-rich-markdoc)
// Used under MIT license (couldn't install it as a library because 6000000 build issues)

// node_modules/codemirror-rich-markdoc/src/index.ts
import { ViewPlugin } from "@codemirror/view";
import { syntaxHighlighting } from "@codemirror/language";
import { markdown } from "@codemirror/lang-markdown";

// node_modules/codemirror-rich-markdoc/src/tagParser.ts
import { tags as t } from "@lezer/highlight";
var tagParser_default = {
  defineNodes: [
    { name: "MarkdocTag", block: true, style: t.meta }
  ],
  parseBlock: [{
    name: "MarkdocTag",
    endLeaf(_cx, line, _leaf) {
      return line.next == 123 && line.text.slice(line.pos).trim().startsWith("{%");
    },
    parse(cx, line) {
      if (line.next != 123) return false;
      const content = line.text.slice(line.pos).trim();
      if (!content.startsWith("{%") || !content.endsWith("%}")) return false;
      cx.addElement(cx.elt("MarkdocTag", cx.lineStart, cx.lineStart + line.text.length));
      cx.nextLine();
      return true;
    }
  }]
};

// node_modules/codemirror-rich-markdoc/src/highlightStyle.ts
import { HighlightStyle } from "@codemirror/language";
import { tags as t2 } from "@lezer/highlight";
var highlightStyle_default = HighlightStyle.define([
  { tag: t2.heading1, fontWeight: "bold", fontFamily: "sans-serif", fontSize: "32px", textDecoration: "none" },
  { tag: t2.heading2, fontWeight: "bold", fontFamily: "sans-serif", fontSize: "28px", textDecoration: "none" },
  { tag: t2.heading3, fontWeight: "bold", fontFamily: "sans-serif", fontSize: "24px", textDecoration: "none" },
  { tag: t2.heading4, fontWeight: "bold", fontFamily: "sans-serif", fontSize: "22px", textDecoration: "none" },
  { tag: t2.link, fontFamily: "sans-serif", textDecoration: "underline", color: "blue" },
  { tag: t2.emphasis, fontFamily: "sans-serif", fontStyle: "italic" },
  { tag: t2.strong, fontFamily: "sans-serif", fontWeight: "bold" },
  { tag: t2.monospace, fontFamily: "monospace" },
  { tag: t2.content, fontFamily: "sans-serif" },
  { tag: t2.meta, color: "darkgrey" },
  { tag: t2.strikethrough, color: "darkgrey", textDecoration: "line-through" }
]);

// node_modules/codemirror-rich-markdoc/src/richEdit.ts
import { Decoration } from "@codemirror/view";
import { syntaxTree } from "@codemirror/language";
var tokenElement = [
  "InlineCode",
  "Emphasis",
  "StrongEmphasis",
  "FencedCode",
  "Link"
];
var tokenHidden = [
  "HardBreak",
  "LinkMark",
  "EmphasisMark",
  "CodeMark",
  "CodeInfo",
  "URL"
];
var decorationHidden = Decoration.mark({ class: "cm-markdoc-hidden" });
var decorationBullet = Decoration.mark({ class: "cm-markdoc-bullet" });
var decorationCode = Decoration.mark({ class: "cm-markdoc-code" });
var decorationTag = Decoration.mark({ class: "cm-markdoc-tag" });
var RichEditPlugin = class {
  decorations;
  constructor(view) {
    this.decorations = this.process(view);
  }
  update(update) {
    if (update.docChanged || update.viewportChanged || update.selectionSet)
      this.decorations = this.process(update.view);
  }
  process(view) {
    let widgets = [];
    let [cursor] = view.state.selection.ranges;
    for (let { from, to } of view.visibleRanges) {
      syntaxTree(view.state).iterate({
        from,
        to,
        enter(node) {
          if (node.name === "MarkdocTag")
            widgets.push(decorationTag.range(node.from, node.to));
          if (node.name === "FencedCode")
            widgets.push(decorationCode.range(node.from, node.to));
          if ((node.name.startsWith("ATXHeading") || tokenElement.includes(node.name)) && cursor.from >= node.from && cursor.to <= node.to)
            return false;
          if (node.name === "ListMark" && node.matchContext(["BulletList", "ListItem"]) && cursor.from != node.from && cursor.from != node.from + 1)
            widgets.push(decorationBullet.range(node.from, node.to));
          if (node.name === "HeaderMark")
            widgets.push(decorationHidden.range(node.from, node.to + 1));
          if (tokenHidden.includes(node.name))
            widgets.push(decorationHidden.range(node.from, node.to));
        }
      });
    }
    return Decoration.set(widgets);
  }
};

// node_modules/codemirror-rich-markdoc/src/renderBlock.ts
import { Decoration as Decoration2, WidgetType, EditorView } from "@codemirror/view";
import { RangeSet, StateField } from "@codemirror/state";
import { syntaxTree as syntaxTree2 } from "@codemirror/language";
import markdoc from "@markdoc/markdoc";
var patternTag = /{%\s*(?<closing>\/)?(?<tag>[a-zA-Z0-9-_]+)(?<attrs>\s+[^]+)?\s*(?<self>\/)?%}\s*$/m;
var RenderBlockWidget = class extends WidgetType {
  constructor(source, config) {
    super();
    this.source = source;
    const document2 = markdoc.parse(source);
    const transformed = markdoc.transform(document2, config);
    this.rendered = markdoc.renderers.html(transformed);
  }
  rendered;
  eq(widget) {
    return widget.source === widget.source;
  }
  toDOM() {
    let content = document.createElement("div");
    content.setAttribute("contenteditable", "false");
    content.className = "cm-markdoc-renderBlock";
    content.innerHTML = this.rendered;
    return content;
  }
  ignoreEvent() {
    return false;
  }
};
function replaceBlocks(state, config, from, to) {
  const decorations = [];
  const [cursor] = state.selection.ranges;
  const tags = [];
  const stack = [];
  syntaxTree2(state).iterate({
    from,
    to,
    enter(node) {
      if (!["Table", "Blockquote", "MarkdocTag"].includes(node.name))
        return;
      if (node.name === "MarkdocTag") {
        const text2 = state.doc.sliceString(node.from, node.to);
        const match = text2.match(patternTag);
        if (match?.groups?.self) {
          tags.push([node.from, node.to]);
          return;
        }
        if (match?.groups?.closing) {
          const last = stack.pop();
          if (last) tags.push([last, node.to]);
          return;
        }
        stack.push(node.from);
        return;
      }
      if (cursor.from >= node.from && cursor.to <= node.to)
        return false;
      const text = state.doc.sliceString(node.from, node.to);
      const decoration = Decoration2.replace({
        widget: new RenderBlockWidget(text, config),
        block: true
      });
      decorations.push(decoration.range(node.from, node.to));
    }
  });
  for (let [from2, to2] of tags) {
    if (cursor.from >= from2 && cursor.to <= to2) continue;
    const text = state.doc.sliceString(from2, to2);
    const decoration = Decoration2.replace({
      widget: new RenderBlockWidget(text, config),
      block: true
    });
    decorations.push(decoration.range(from2, to2));
  }
  return decorations;
}
function renderBlock_default(config) {
  return StateField.define({
    create(state) {
      return RangeSet.of(replaceBlocks(state, config), true);
    },
    update(decorations, transaction) {
      return RangeSet.of(replaceBlocks(transaction.state, config), true);
    },
    provide(field) {
      return EditorView.decorations.from(field);
    }
  });
}

// node_modules/codemirror-rich-markdoc/src/index.ts
function index_default(config) {
  const mergedConfig = {
    ...config.lezer ?? [],
    extensions: [tagParser_default, ...config.lezer?.extensions ?? []]
  };
  return ViewPlugin.fromClass(RichEditPlugin, {
    decorations: (v) => v.decorations,
    provide: (v) => [
      renderBlock_default(config.markdoc),
      syntaxHighlighting(highlightStyle_default),
      markdown(mergedConfig)
    ],
    eventHandlers: {
      mousedown({ target }, view) {
        if (target instanceof Element && target.matches(".cm-markdoc-renderBlock *"))
          view.dispatch({ selection: { anchor: view.posAtDOM(target) } });
      }
    }
  });
}
export {
  index_default as default
};
