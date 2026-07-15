import { useEffect, useMemo, useState } from "react";
import { useEditor, EditorContent } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import Link from "@tiptap/extension-link";
import Placeholder from "@tiptap/extension-placeholder";
import { docApi, type FileData } from "./api";
import { markdownToHtml, htmlToMarkdown } from "./markdown";
import Toolbar from "./Toolbar";

type SaveState = "idle" | "saving" | "saved" | "error" | "conflict";

function useQueryParams() {
  return useMemo(() => new URLSearchParams(window.location.search), []);
}

export default function App() {
  const params = useQueryParams();
  const section = params.get("section") || "";
  const path = params.get("path") || "";

  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [file, setFile] = useState<FileData | null>(null);
  const [saveState, setSaveState] = useState<SaveState>("idle");
  const [saveMessage, setSaveMessage] = useState<string>("");

  const editor = useEditor({
    extensions: [
      StarterKit,
      Link.configure({ openOnClick: false }),
      Placeholder.configure({ placeholder: "开始编辑…" }),
    ],
    content: "",
  });

  useEffect(() => {
    if (!section || !path) {
      setLoadError("缺少 section / path 参数");
      setLoading(false);
      return;
    }
    docApi
      .getFile(section, path)
      .then((data) => {
        setFile(data);
        editor?.commands.setContent(markdownToHtml(data.content));
      })
      .catch((e) => setLoadError(e.message || "加载失败"))
      .finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [section, path, editor]);

  async function handleSave() {
    if (!editor || !file) return;
    setSaveState("saving");
    setSaveMessage("");
    try {
      const markdown = htmlToMarkdown(editor.getHTML());
      const result = await docApi.saveFile(section, path, markdown, file.sha, `docs: update ${path} via web editor`);
      setFile({ ...file, content: markdown, sha: result.sha });
      setSaveState("saved");
      setTimeout(() => setSaveState("idle"), 2000);
    } catch (e: any) {
      if (e.status === 409) {
        setSaveState("conflict");
        setSaveMessage("文件已被他人修改，请刷新页面后重新编辑，避免覆盖对方的修改。");
      } else {
        setSaveState("error");
        setSaveMessage(e.message || "保存失败");
      }
    }
  }

  async function handleReload() {
    setLoading(true);
    setSaveState("idle");
    try {
      const data = await docApi.getFile(section, path);
      setFile(data);
      editor?.commands.setContent(markdownToHtml(data.content));
    } catch (e: any) {
      setLoadError(e.message || "加载失败");
    } finally {
      setLoading(false);
    }
  }

  if (loading) {
    return <div className="center-msg">加载中…</div>;
  }

  if (loadError) {
    return <div className="center-msg error">❌ {loadError}</div>;
  }

  return (
    <div className="editor-shell">
      <header className="editor-header">
        <div className="editor-title">
          <span className="editor-title-section">{section}</span>
          <span className="editor-title-sep">/</span>
          <span className="editor-title-path">{path}</span>
        </div>
        <div className="editor-actions">
          {saveState === "saved" && <span className="save-hint saved">✔ 已保存</span>}
          {saveState === "conflict" && <span className="save-hint conflict">⚠ {saveMessage}</span>}
          {saveState === "error" && <span className="save-hint error">❌ {saveMessage}</span>}
          {saveState === "conflict" && (
            <button className="btn btn-secondary" onClick={handleReload}>
              刷新最新内容
            </button>
          )}
          <button className="btn btn-primary" onClick={handleSave} disabled={saveState === "saving"}>
            {saveState === "saving" ? "保存中…" : "保存"}
          </button>
        </div>
      </header>

      {editor && <Toolbar editor={editor} />}

      <main className="editor-main">
        <EditorContent editor={editor} className="tiptap-content" />
      </main>
    </div>
  );
}
