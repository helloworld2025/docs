// Markdown <-> HTML 互转，供 Tiptap 富文本编辑器使用。
// - 打开文件：markdownToHtml() 把源文件的 Markdown 转成 HTML 喂给 Tiptap
// - 保存文件：htmlToMarkdown() 把 Tiptap 编辑后的 HTML 转回 Markdown 再提交
import { marked } from "marked";
import TurndownService from "turndown";

const turndown = new TurndownService({
  headingStyle: "atx",
  codeBlockStyle: "fenced",
  bulletListMarker: "-",
});

export function markdownToHtml(markdown: string): string {
  return marked.parse(markdown, { async: false }) as string;
}

export function htmlToMarkdown(html: string): string {
  return turndown.turndown(html);
}
