/**
 * Rust 쪽 커맨드 래퍼. 파일 I/O 와 스킬 설치는 전부 여기를 지난다.
 *
 * 브라우저(`npm run dev` 로 vite 만 띄운 경우)에서도 앱이 뜨게 만든다 —
 * 네이티브가 없으면 `HAS_TAURI` 가 false 이고, 파일 기능은 브라우저 다운로드/업로드로
 * 내려앉는다. 그래야 화면 검수를 브라우저에서 할 수 있다.
 */
import { invoke } from "@tauri-apps/api/core";
import { confirm, open, save } from "@tauri-apps/plugin-dialog";

export interface SkillStatus {
  target: string;
  installed: boolean;
  bundled_files: number;
  up_to_date: boolean;
  missing: string[];
  differing: string[];
  extra: string[];
  bundled_version: string;
  installed_version: string | null;
}

export interface FileInfo {
  name: string;
  path: string;
}

/** 네이티브 셸 안에서 도는가. 브라우저면 파일 기능이 다운로드로 대체된다. */
export const HAS_TAURI =
  typeof window !== "undefined" &&
  ("__TAURI_INTERNALS__" in window || "__TAURI__" in window);

export const api = {
  readText: (path: string) => invoke<string>("read_text", { path }),
  writeText: (path: string, contents: string) => invoke<FileInfo>("write_text", { path, contents }),
  readDataUri: (path: string) => invoke<string>("read_data_uri", { path }),
  fileSize: (path: string) => invoke<number>("file_size", { path }),
  openFile: (path: string) => invoke<void>("open_file", { path }),
  revealFile: (path: string) => invoke<void>("reveal_file", { path }),
  homeDir: () => invoke<string | null>("home_dir"),
  tempPath: (name: string) => invoke<string>("temp_path", { name }),
  removeFile: (path: string) => invoke<void>("remove_file", { path }),
  skillStatus: (root?: string) => invoke<SkillStatus>("skill_status", { root: root ?? null }),
  skillInstall: (root?: string) => invoke<SkillStatus>("skill_install", { root: root ?? null }),
  skillRemove: (root?: string) => invoke<SkillStatus>("skill_remove", { root: root ?? null }),
};

const JSON_FILTER = [{ name: "덱 스펙", extensions: ["json"] }];

export const dialogs = {
  openDeck: () => open({ multiple: false, filters: JSON_FILTER }) as Promise<string | null>,
  openTable: () =>
    open({
      multiple: false,
      filters: [{ name: "표·목록", extensions: ["csv", "tsv", "txt", "md"] }],
    }) as Promise<string | null>,
  openImage: () =>
    open({
      multiple: false,
      filters: [{ name: "이미지", extensions: ["png", "jpg", "jpeg", "webp", "gif", "svg"] }],
    }) as Promise<string | null>,
  saveDeck: (name: string) => save({ defaultPath: name, filters: JSON_FILTER }),
  saveHtml: (name: string) =>
    save({ defaultPath: name, filters: [{ name: "단일 HTML", extensions: ["html"] }] }),
  saveCsv: (name: string) =>
    save({ defaultPath: name, filters: [{ name: "CSV", extensions: ["csv"] }] }),
  pickFolder: () => open({ directory: true }) as Promise<string | null>,
};

/** 웹뷰의 window.confirm 은 플랫폼마다 다르게 뜬다 — 네이티브 다이얼로그를 쓴다. */
export const ask = (message: string, title: string) =>
  HAS_TAURI
    ? confirm(message, { title, kind: "warning", okLabel: "계속", cancelLabel: "취소" })
    : Promise.resolve(window.confirm(`${title}\n\n${message}`));

/** 브라우저 폴백 — 네이티브 저장 다이얼로그가 없으면 다운로드한다. */
export function download(name: string, contents: string, mime: string): void {
  const url = URL.createObjectURL(new Blob([contents], { type: `${mime};charset=utf-8` }));
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** 브라우저 폴백 — 파일 하나를 텍스트로 읽는다. */
export function pickTextFile(accept: string): Promise<{ name: string; text: string } | null> {
  const { promise, resolve } = Promise.withResolvers<{ name: string; text: string } | null>();
  const input = document.createElement("input");
  input.type = "file";
  input.accept = accept;
  input.onchange = async () => {
    const file = input.files && input.files[0];
    resolve(file ? { name: file.name, text: await file.text() } : null);
  };
  input.oncancel = () => resolve(null);
  input.click();
  return promise;
}

/**
 * 브라우저 폴백 — 이미지 하나를 data URI 로 읽는다.
 * 카드에 넣는 그림은 산출물 안에 심어야 단일 파일이 유지되므로, 경로가 아니라 data URI 가 필요하다.
 */
export function pickImageDataUri(): Promise<string | null> {
  const { promise, resolve } = Promise.withResolvers<string | null>();
  const input = document.createElement("input");
  input.type = "file";
  input.accept = "image/*";
  input.onchange = () => {
    const file = input.files && input.files[0];
    if (!file) return resolve(null);
    const reader = new FileReader();
    reader.onload = () => resolve(typeof reader.result === "string" ? reader.result : null);
    reader.onerror = () => resolve(null);
    reader.readAsDataURL(file);
  };
  input.oncancel = () => resolve(null);
  input.click();
  return promise;
}
