import type { Editor } from "@tiptap/react";

export default function Toolbar({ editor }: { editor: Editor }) {
  return (
    <div className="editor-toolbar">
      <button
        className={editor.isActive("heading", { level: 1 }) ? "active" : ""}
        onClick={() => editor.chain().focus().toggleHeading({ level: 1 }).run()}
      >
        H1
      </button>
      <button
        className={editor.isActive("heading", { level: 2 }) ? "active" : ""}
        onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()}
      >
        H2
      </button>
      <button
        className={editor.isActive("heading", { level: 3 }) ? "active" : ""}
        onClick={() => editor.chain().focus().toggleHeading({ level: 3 }).run()}
      >
        H3
      </button>
      <span className="toolbar-sep" />
      <button className={editor.isActive("bold") ? "active" : ""} onClick={() => editor.chain().focus().toggleBold().run()}>
        <b>B</b>
      </button>
      <button className={editor.isActive("italic") ? "active" : ""} onClick={() => editor.chain().focus().toggleItalic().run()}>
        <i>I</i>
      </button>
      <button className={editor.isActive("strike") ? "active" : ""} onClick={() => editor.chain().focus().toggleStrike().run()}>
        <s>S</s>
      </button>
      <button className={editor.isActive("code") ? "active" : ""} onClick={() => editor.chain().focus().toggleCode().run()}>
        {"</>"}
      </button>
      <span className="toolbar-sep" />
      <button className={editor.isActive("bulletList") ? "active" : ""} onClick={() => editor.chain().focus().toggleBulletList().run()}>
        • 列表
      </button>
      <button className={editor.isActive("orderedList") ? "active" : ""} onClick={() => editor.chain().focus().toggleOrderedList().run()}>
        1. 列表
      </button>
      <button className={editor.isActive("blockquote") ? "active" : ""} onClick={() => editor.chain().focus().toggleBlockquote().run()}>
        引用
      </button>
      <button className={editor.isActive("codeBlock") ? "active" : ""} onClick={() => editor.chain().focus().toggleCodeBlock().run()}>
        代码块
      </button>
      <span className="toolbar-sep" />
      <button onClick={() => editor.chain().focus().setHorizontalRule().run()}>分割线</button>
      <button
        onClick={() => {
          const url = window.prompt("链接地址：");
          if (url) editor.chain().focus().setLink({ href: url }).run();
        }}
      >
        链接
      </button>
    </div>
  );
}
