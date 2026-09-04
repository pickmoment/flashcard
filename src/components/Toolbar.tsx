/**
 * 파일 · 실행 취소 · 내보내기. 디스크에 닿는 조작은 전부 App 이 들고 있고 여기는 버튼만 그린다.
 * 최근 목록만은 여기서 읽는다 — 문서 상태와 무관한 앱 데이터고, 펼칠 때마다 새로 읽어야
 * 지워진 파일이 걸러진 목록이 나온다.
 */
import { useEffect, useRef, useState } from "react";
import type { Deck } from "../engine/types";
import { recent } from "../lib/recent";
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
  onOpenRecent(path: string): void;
  onSave(): void;
  onSaveAs(): void;
  onExportHtml(): void;
  onExportCsv(): void;
  onUndo(): void;
  onRedo(): void;
}) {
  const mac = typeof navigator !== "undefined" && /Mac/.test(navigator.platform);
  const mod = mac ? "⌘" : "Ctrl+";
  const shiftMod = mac ? "⇧⌘" : "Ctrl+Shift+";
  const where = props.path ? props.path.replace(/^.*\//, "") : "저장 안 됨";

  /* 최근 목록. null 은 읽는 중 — 펼친 직후 빈 목록이 깜빡이지 않게 구분한다 */
  const [menu, setMenu] = useState(false);
  const [items, setItems] = useState<string[] | null>(null);
  const wrap = useRef<HTMLDivElement>(null);

  const openMenu = () => {
    setItems(null);
    setMenu(true);
    void recent.prune().then(setItems, () => setItems([]));
  };

  /* 밖을 누르거나 Esc 로 닫는다 — 열려 있을 때만 듣는다 */
  useEffect(() => {
    if (!menu) return;
    const down = (e: MouseEvent) => {
      if (!wrap.current?.contains(e.target as Node)) setMenu(false);
    };
    const key = (e: KeyboardEvent) => {
      if (e.key === "Escape") setMenu(false);
    };
    document.addEventListener("mousedown", down);
    document.addEventListener("keydown", key);
    return () => {
      document.removeEventListener("mousedown", down);
      document.removeEventListener("keydown", key);
    };
  }, [menu]);

  return (
    <header className="app-head">
      <div className="brand">
        flashcard
        <small>플래시카드 덱 에디터</small>
      </div>

      <div className="group">
        <button className="btn" onClick={props.onNew} title={`${shiftMod}N`}>
          새 덱
        </button>
        <button className="btn" onClick={props.onOpen} title={`${mod}O`}>
          열기
        </button>
        {/* 브라우저 모드는 경로가 없어 최근 파일이 성립하지 않는다 */}
        {HAS_TAURI ? (
          <div className="menu-wrap" ref={wrap}>
            <button
              className={`btn ghost${menu ? " on" : ""}`}
              onClick={() => (menu ? setMenu(false) : openMenu())}
              title="최근에 열거나 저장한 덱"
              aria-haspopup="menu"
              aria-expanded={menu}
            >
              최근 ▾
            </button>
            {menu ? (
              <div className="menu" role="menu">
                {items === null ? (
                  <button className="menu-item" disabled>
                    <span className="muted">읽는 중…</span>
                  </button>
                ) : items.length === 0 ? (
                  <button className="menu-item" disabled>
                    <span className="muted">최근 파일이 없다</span>
                  </button>
                ) : (
                  items.map((p) => {
                    const cut = p.lastIndexOf("/");
                    return (
                      <button
                        key={p}
                        className="menu-item"
                        role="menuitem"
                        title={p}
                        onClick={() => {
                          setMenu(false);
                          props.onOpenRecent(p);
                        }}
                      >
                        <span>{cut < 0 ? p : p.slice(cut + 1)}</span>
                        {cut < 0 ? null : <span className="muted mono">{p.slice(0, cut)}</span>}
                      </button>
                    );
                  })
                )}
              </div>
            ) : null}
          </div>
        ) : null}
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
          title={props.valid ? `단일 HTML 로 내보낸다 (${mod}E)` : "검증 오류를 고쳐야 내보낼 수 있다"}
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
