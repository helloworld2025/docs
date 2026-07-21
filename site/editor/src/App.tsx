import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { useEditor, EditorContent } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import Link from "@tiptap/extension-link";
import Placeholder from "@tiptap/extension-placeholder";
import { docApi, type DocTree, type FileData } from "./api";
import { markdownToHtml, htmlToMarkdown } from "./markdown";
import { treeEntryToApiPath, isSyncedSection } from "./pathMapping";

import Toolbar from "./Toolbar";
import Sidebar from "./Sidebar";

type SaveState = "idle" | "saving" | "saved" | "error" | "conflict";

function useQueryParams() {
  return useMemo(() => new URLSearchParams(window.location.search), []);
}

// 新建文档时，文件名相对该分区根目录（例如 "docs/new-topic.md"），
// 与文档树里 path 字段的含义一致，会经 pathMapping.treeEntryToApiPath
// 换算成源仓库真实路径后再提交。
function normalizeNewFileName(input: string): string | null {
  let name = input.trim();
  if (!name) return null;
  if (!name.endsWith(".md")) name += ".md";
  name = name.replace(/^\/+/, "");
  return name;
}

export default function App() {
  const initialParams = useQueryParams();
  // 首页 Hero / 顶部导航的"＋ 新建分类"入口跳转过来时会带上
  // ?action=create-section，不携带 section/path，页面加载后自动弹出新建
  // 分类的输入框（见下方 effect），而不是显示"缺少参数"的错误态。
  const initialAction = initialParams.get("action");

  // 注意区分两种路径概念：
  // - apiPath：源仓库里的真实文件路径，是 /api/file 唯一认识的格式，也是
  //   URL 查询参数 `path` 携带的值（VitePress "编辑此页" 链接算出来的就是这个）。
  // - treePath：/api/tree（doc-tree.json）里的 path 字段，相对镜像目录，
  //   仅用于侧边栏渲染/高亮，需要经 pathMapping.treeEntryToApiPath 换算成
  //   apiPath 才能拿去请求。两者不总是一一对应（如 index.md 和 README.md
  //   可能指向同一个 apiPath），因此不能互相替代，必须都保留。
  const [section, setSection] = useState(initialParams.get("section") || "");
  const [apiPath, setApiPath] = useState(initialParams.get("path") || "");
  const [treePath, setTreePath] = useState<string | undefined>(undefined);


  const [tree, setTree] = useState<DocTree>({});
  const [treeError, setTreeError] = useState<string | null>(null);

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

  const refreshTree = useCallback(() => {
    docApi
      .tree()
      .then((data) => {
        setTree(data);
        setTreeError(null);
      })
      .catch((e) => setTreeError(e.message || "加载文档目录失败"));
  }, []);

  useEffect(() => {
    refreshTree();
  }, [refreshTree]);

  // 文档树加载完成后，尽力反推当前 apiPath 对应的 treePath，仅用于侧边栏高亮，
  // 找不到（比如通过手改 URL 直接打开某个 apiPath）也不影响正常编辑。
  useEffect(() => {
    if (!section || !apiPath) return;
    const entries = tree[section] || [];
    const match = entries.find((f) => treeEntryToApiPath(section, f.path) === apiPath);
    setTreePath(match?.path);
  }, [tree, section, apiPath]);

  function navigateTo(nextSection: string, nextTreePath: string) {
    const nextApiPath = treeEntryToApiPath(nextSection, nextTreePath);
    setSection(nextSection);
    setApiPath(nextApiPath);
    setTreePath(nextTreePath);
    const url = new URL(window.location.href);
    url.searchParams.set("section", nextSection);
    url.searchParams.set("path", nextApiPath);
    window.history.replaceState(null, "", url.toString());
  }

  useEffect(() => {
    if (!section || !apiPath) {
      // 没有指定要打开的文档：可能是首页/顶部导航的"＋ 新建分类"入口跳转过来的
      // （没有 section/path，只有 action 参数），也可能是直接打开 /edit/ 没带
      // 任何参数。两种情况都不算错误，展示一个引导态而不是报错。
      setLoadError(null);
      setLoading(false);
      return;
    }
    setLoading(true);
    setLoadError(null);
    docApi
      .getFile(section, apiPath)
      .then((data) => {
        setFile(data);
        editor?.commands.setContent(markdownToHtml(data.content));
      })
      .catch((e) => setLoadError(e.message || "加载失败"))
      .finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [section, apiPath, editor]);


  async function handleSave() {
    if (!editor || !file) return;
    setSaveState("saving");
    setSaveMessage("");
    try {
      const markdown = htmlToMarkdown(editor.getHTML());
      const result = await docApi.saveFile(section, apiPath, markdown, file.sha, `docs: update ${apiPath} via web editor`);
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
      const data = await docApi.getFile(section, apiPath);
      setFile(data);
      editor?.commands.setContent(markdownToHtml(data.content));
    } catch (e: any) {
      setLoadError(e.message || "加载失败");
    } finally {
      setLoading(false);
    }
  }

  async function handleCreate(targetSection: string) {
    const input = window.prompt(
      `新建文档路径（相对 ${targetSection}/ 根目录，如 "docs/new-topic.md"）：`
    );
    if (input == null) return;
    const newTreePath = normalizeNewFileName(input);
    if (!newTreePath) return;

    const existing = (tree[targetSection] || []).some((f) => f.path === newTreePath);
    if (existing) {
      window.alert("该路径已存在同名文档，请换一个文件名。");
      return;
    }

    const newApiPath = treeEntryToApiPath(targetSection, newTreePath);
    try {
      await docApi.saveFile(
        targetSection,
        newApiPath,
        `# ${newTreePath.replace(/\.md$/, "")}\n`,
        undefined,
        `docs: create ${newApiPath} via web editor`
      );
      refreshTree();
      navigateTo(targetSection, newTreePath);
    } catch (e: any) {
      window.alert(`新建失败：${e.message || e}`);
    }
  }

  async function handleDelete(targetSection: string, targetTreePath: string) {
    if (!window.confirm(`确定要删除「${targetSection}/${targetTreePath}」吗？此操作会直接提交到源仓库，不可撤销。`)) {
      return;
    }
    const targetApiPath = treeEntryToApiPath(targetSection, targetTreePath);
    try {
      // 删除前先取最新 sha，避免拿着过期 sha 导致 GitHub 返回 409。
      const latest = await docApi.getFile(targetSection, targetApiPath);
      await docApi.deleteFile(targetSection, targetApiPath, latest.sha, `docs: delete ${targetApiPath} via web editor`);
      refreshTree();
      if (section === targetSection && apiPath === targetApiPath) {
        setFile(null);
        setLoadError("该文档已被删除");
      }
    } catch (e: any) {
      if (e.status === 409) {
        window.alert("删除失败：文件已被他人修改，请刷新目录后重试。");
      } else {
        window.alert(`删除失败：${e.message || e}`);
      }
    }
  }

  // 新建一级分类：区别于"分类内新建文档"，这里创建的是一个全新的顶级分类
  // （在 docs 仓库里对应新建 site/docs/<分类名>/index.md）。不能跟固定的
  // account/relay/analytics（同步类）或已存在的分类重名。创建后会立即在源
  // 仓库生效，但要等下次 sync + build + deploy 才会出现在网站顶部导航栏。
  async function handleCreateSection() {
    const input = window.prompt("新建一级分类名称（英文/数字/短横线，如 \"design\"）：");
    if (input == null) return;
    const name = input.trim().toLowerCase().replace(/[^a-z0-9-]/g, "-").replace(/^-+|-+$/g, "");
    if (!name) {
      window.alert("分类名称无效，请使用英文字母、数字或短横线。");
      return;
    }
    if (isSyncedSection(name)) {
      window.alert(`"${name}" 是固定的同步分类，不能新建同名分类。`);
      return;
    }
    if (name in tree) {
      window.alert(`分类 "${name}" 已存在。`);
      return;
    }

    const newApiPath = `site/docs/${name}/index.md`;
    try {
      await docApi.saveFile(
        name,
        newApiPath,
        `# ${name}\n`,
        undefined,
        `docs: create section ${name} via web editor`
      );
      refreshTree();
      navigateTo(name, "index.md");
      window.alert(
        `分类 "${name}" 已创建，内容已提交到源仓库。\n提示：新分类要等下次重新部署（sync + build + deploy）后才会出现在网站顶部导航栏。`
      );
    } catch (e: any) {
      window.alert(`新建分类失败：${e.message || e}`);
    }
  }

  // 首页 Hero / 顶部导航的"＋ 新建分类"入口带 ?action=create-section 跳转过来时，
  // 页面挂载后自动触发一次新建分类流程。React 18 StrictMode 开发模式下 effect
  // 会执行两次，用 ref 保证只弹一次输入框。
  const autoCreateSectionTriggered = useRef(false);
  useEffect(() => {
    if (initialAction !== "create-section") return;
    if (autoCreateSectionTriggered.current) return;
    autoCreateSectionTriggered.current = true;
    handleCreateSection();
    // 清掉 URL 上的 action 参数，避免用户之后刷新页面又重新弹一次。
    const url = new URL(window.location.href);
    url.searchParams.delete("action");
    window.history.replaceState(null, "", url.toString());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialAction]);

  let mainContent: React.ReactNode;
  if (loading) {
    mainContent = <div className="center-msg">加载中…</div>;
  } else if (loadError) {
    mainContent = <div className="center-msg error">❌ {loadError}</div>;
  } else if (!section || !apiPath) {
    mainContent = (
      <div className="center-msg">
        <div className="empty-state">
          <p>请从左侧选择一篇文档进行编辑，</p>
          <p>
            或点击左上角{" "}
            <button className="btn btn-secondary" onClick={handleCreateSection}>
              ＋分类
            </button>{" "}
            新建一个一级分类。
          </p>
        </div>
      </div>
    );
  } else {

    mainContent = (
      <div className="editor-shell">
        <header className="editor-header">
          <div className="editor-title">
            <span className="editor-title-section">{section}</span>
            <span className="editor-title-sep">/</span>
            <span className="editor-title-path">{apiPath}</span>
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

  return (
    <div className="app-shell">
      <Sidebar
        tree={tree}
        treeError={treeError}
        selectedSection={section}
        selectedTreePath={treePath}
        onSelect={navigateTo}
        onCreate={handleCreate}
        onDelete={handleDelete}
        onCreateSection={handleCreateSection}
      />
      <div className="app-main">{mainContent}</div>
    </div>
  );
}
