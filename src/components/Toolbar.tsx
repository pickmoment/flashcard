/** 파일 · 실행 취소 · 내보내기. 디스크에 닿는 조작은 전부 App 이 들고 있고 여기는 버튼만 그린다. */
import type { Deck } from "../engine/types";
import { HAS_TAURI } from "../lib/tauri";

export function Toolbar(props: {
  deck: Deck;
  path: string | null;
  dirty: boolean;
  canUndo: boolean;
  canRedo: boolean;
  /** 검증 오류가 없는가 — 오류가 있으면 내보내기를 막는다 */
  valid: boolean;
  onNew(): void;
  onOpen(): void;
  onSave(): void;
  onSaveAs(): void;
  onExportHtml(): void;
  onExportCsv(): void;
  onUndo(): void;
  onRedo(): void;
}) {
  const mac = typeof navigator !== "undefined" && /Mac/.test(navigator.platform);
  const mod = mac ? "⌘" : "Ctrl+";
  const where = props.path ? props.path.replace(/^.*\//, "") : "저장 안 됨";

  return (
    <header className="app-head">
      <div className="brand">
        flashcard
        <small>플래시카드 덱 에디터</small>
      </div>

      <div className="group">
        <button className="btn" onClick={props.onNew}>
          새 덱
        </button>
        <button className="btn" onClick={props.onOpen} title={`${mod}O`}>
          열기
        </button>
        <button className="btn" onClick={props.onSave} title={`${mod}S`}>
          저장
        </button>
        <button className="btn ghost" onClick={props.onSaveAs}>
          다른 이름으로
        </button>
      </div>

      <div className="group">
        <button className="btn ghost" onClick={props.onUndo} disabled={!props.canUndo} title={`${mod}Z`}>
          ↶
        </button>
        <button
          className="btn ghost"
          onClick={props.onRedo}
          disabled={!props.canRedo}
          title={mac ? "⇧⌘Z" : "Ctrl+Y"}
        >
          ↷
        </button>
      </div>

      <div className="group">
        <button
          className="btn primary"
          onClick={props.onExportHtml}
          disabled={!props.valid}
          title={props.valid ? "단일 HTML 로 내보낸다" : "검증 오류를 고쳐야 내보낼 수 있다"}
        >
          HTML 내보내기
        </button>
        <button className="btn" onClick={props.onExportCsv}>
          CSV
        </button>
      </div>

      <div className="spacer" />

      <span className="muted mono" title={props.path ?? undefined}>
        {where}
        {props.dirty ? " •" : ""}
      </span>
      <span className="badge mute">카드 {props.deck.cards.length}</span>
      {/* 네이티브가 없으면 파일 기능이 브라우저 다운로드/업로드로 내려앉는다 — 그 사실을 숨기지 않는다 */}
      {HAS_TAURI ? null : <span className="badge warn">브라우저 모드</span>}
    </header>
  );
}
