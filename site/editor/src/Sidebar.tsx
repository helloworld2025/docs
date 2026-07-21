import { useState } from "react";
import type { DocTree, DocTreeFile } from "./api";
import { isSyncedSection, SYNCED_SECTIONS } from "./pathMapping";

const SECTION_LABELS: Record<string, string> = {
  general: "综合文档",
  account: "Account (SSO)",
  relay: "Relay",
  analytics: "Analytics",
};

const SYNCED_GROUP_LABEL = "业务文档";

function SectionBlock({
  section,
  tree,
  selectedSection,
  selectedTreePath,
  onSelect,
  onCreate,
  onDelete,
  allowCreate = true,
}: {
  section: string;
  tree: DocTree;
  selectedSection?: string;
  selectedTreePath?: string;
  onSelect: (section: string, treePath: string) => void;
  onCreate: (section: string) => void;
  onDelete: (section: string, treePath: string) => void;
  allowCreate?: boolean;
}) {
  return (
    <div className="sidebar-section">
      <div className="sidebar-section-header">
        <span>{SECTION_LABELS[section] || section}</span>
        {allowCreate && (
          <button className="sidebar-icon-btn" title="新建文档" onClick={() => onCreate(section)}>
            ＋
          </button>
        )}
      </div>
      <ul className="sidebar-file-list">
        {(tree[section] || []).map((f: DocTreeFile) => {
          const active = selectedSection === section && selectedTreePath === f.path;
          return (
            <li key={f.path} className={active ? "sidebar-file active" : "sidebar-file"}>
              <span className="sidebar-file-label" onClick={() => onSelect(section, f.path)}>
                {f.label}
              </span>
              <button
                className="sidebar-icon-btn danger"
                title="删除文档"
                onClick={() => onDelete(section, f.path)}
              >
                🗑
              </button>
            </li>
          );
        })}
        {(tree[section] || []).length === 0 && <li className="sidebar-empty">暂无文档</li>}
      </ul>
    </div>
  );
}

export default function Sidebar({
  tree,
  treeError,
  selectedSection,
  selectedTreePath,
  onSelect,
  onCreate,
  onDelete,
  onCreateSection,
}: {
  tree: DocTree;
  treeError: string | null;
  selectedSection?: string;
  selectedTreePath?: string;
  onSelect: (section: string, treePath: string) => void;
  onCreate: (section: string) => void;
  onDelete: (section: string, treePath: string) => void;
  onCreateSection: () => void;
}) {
  const [syncedExpanded, setSyncedExpanded] = useState(true);

  // 自定义分类 = tree 里除 account/relay/analytics 外的所有 key（含 general 及
  // 网页端新建的任意分类名），保持 general 优先、其余按名称排序。
  const customSections = Object.keys(tree)
    .filter((s) => !isSyncedSection(s))
    .sort((a, b) => {
      if (a === "general") return -1;
      if (b === "general") return 1;
      return a.localeCompare(b);
    });

  return (
    <aside className="sidebar">
      <div className="sidebar-header">
        <span>文档目录</span>
        <button className="sidebar-icon-btn" title="新建一级分类" onClick={onCreateSection}>
          ＋分类
        </button>
      </div>
      {treeError && <div className="sidebar-error">⚠ {treeError}</div>}
      <div className="sidebar-scroll">
        {customSections.map((section) => (
          <SectionBlock
            key={section}
            section={section}
            tree={tree}
            selectedSection={selectedSection}
            selectedTreePath={selectedTreePath}
            onSelect={onSelect}
            onCreate={onCreate}
            onDelete={onDelete}
          />
        ))}

        <div className="sidebar-section">
          <div
            className="sidebar-section-header sidebar-group-toggle"
            onClick={() => setSyncedExpanded((v) => !v)}
          >
            <span>
              {syncedExpanded ? "▾" : "▸"} {SYNCED_GROUP_LABEL}
            </span>
          </div>
          {syncedExpanded &&
            SYNCED_SECTIONS.filter((s) => s in tree).map((section) => (
              <div className="sidebar-synced-item" key={section}>
                <SectionBlock
                  section={section}
                  tree={tree}
                  selectedSection={selectedSection}
                  selectedTreePath={selectedTreePath}
                  onSelect={onSelect}
                  onCreate={onCreate}
                  onDelete={onDelete}
                  allowCreate={false}
                />
              </div>
            ))}
        </div>
      </div>
    </aside>
  );
}
