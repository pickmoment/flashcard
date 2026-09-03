/**
 * 세 칸 한 화면 — 카드 목록 · 편집 · 실제 산출물.
 *
 * 상태는 여기 하나에 있다(`useDeckStore`). 컴포넌트는 값을 받아 그리고 콜백으로 되돌려주기만
 * 하므로, 같은 덱에 대한 두 개의 진실이 생기지 않는다. 미리보기도 별도 렌더러가 아니라
 * `build(deck, { preview: true })` 로 만든 **실제 산출물**이다 — 화면에서 본 것이 곧 내보낼 파일이다.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { error as logError } from "@tauri-apps/plugin-log";
import { CardForm } from "./components/CardForm";
import { CardList } from "./components/CardList";
import { CheckPanel } from "./components/CheckPanel";
import { DeckSettings } from "./components/DeckSettings";
import { DocsPanel } from "./components/DocsPanel";
import { ExamplesPanel } from "./components/ExamplesPanel";
import { ImportPanel } from "./components/ImportPanel";
import { JsonEditor } from "./components/JsonEditor";
import { Preview } from "./components/Preview";
import { SkillPanel } from "./components/SkillPanel";
import { Toolbar } from "./components/Toolbar";
import { ValidatePanel } from "./components/ValidatePanel";
import { EXAMPLES, FCD } from "./engine/boot";
import type { Card, CardType, Deck } from "./engine/types";
import { build, check, suggestName, validate } from "./lib/build";
import { changeType } from "./lib/cardChange";
import {
  addCard,
  duplicateCard,
  emptyDeck,
  moveCard,
  patchDeck,
  removeCard,
  renumberCards,
  withCard,
} from "./lib/deck";
import {
  HAS_TAURI,
  api,
  dialogs,
  download,
  pickImageDataUri,
  pickTextFile,
} from "./lib/tauri";
import { useDeckStore } from "./lib/useDeckStore";

type EditTab = "card" | "deck" | "json" | "import" | "examples" | "docs" | "skill";
type ViewTab = "preview" | "validate" | "check";

/** 처음 여는 덱 — 백지보다 예제가 낫다. 무엇을 채워야 하는지가 바로 보인다. */
function firstDeck(): Deck {
  return JSON.parse(JSON.stringify(EXAMPLES[0].deck)) as Deck;
}

export default function App() {
  const store = useDeckStore(firstDeck());
  const { deck } = store;

  const [path, setPath] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<number | null>(deck.cards[0]?.id ?? null);
  const [categoryFilter, setCategoryFilter] = useState("all");
  const [editTab, setEditTab] = useState<EditTab>("card");
  const [viewTab, setViewTab] = useState<ViewTab>("preview");
  const [toast, setToast] = useState<{ msg: string; kind: "ok" | "err" | "" } | null>(null);

  /* 토스트는 4초 뒤 사라진다 — 실패는 앱 로그에도 남긴다. 번들에서는 콘솔을 열 수 없어
     로그 파일이 사후에 원인을 찾는 유일한 자리다. */
  const say = useCallback((msg: string, kind?: "ok" | "err") => {
    setToast({ msg, kind: kind ?? "" });
    if (kind === "err" && HAS_TAURI) void logError(msg);
  }, []);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 4200);
    return () => clearTimeout(t);
  }, [toast]);

  /* ---- 검증·빌드 ---- */
  const result = useMemo(() => validate(deck), [deck]);
  const exportHtml = useMemo(() => {
    try {
      return build(deck);
    } catch (e) {
      return `<!-- ${(e as Error).message} -->`;
    }
  }, [deck]);
  const checked = useMemo(() => check(exportHtml), [exportHtml]);

  /**
   * 미리보기는 타이핑마다 iframe 을 다시 로드하면 글자를 칠 수 없다 — 400ms 쉰 뒤에 갈아끼운다.
   * 빌드 자체는 문자열 조작이라 값싸지만, iframe 재로드는 그렇지 않다.
   */
  const [previewHtml, setPreviewHtml] = useState(() => {
    try {
      return build(deck, { preview: true });
    } catch {
      return "";
    }
  });
  useEffect(() => {
    const t = setTimeout(() => {
      try {
        setPreviewHtml(build(deck, { preview: true }));
      } catch (e) {
        say((e as Error).message, "err");
      }
    }, 400);
    return () => clearTimeout(t);
  }, [deck, say]);

  const selected = deck.cards.find((c) => c.id === selectedId) ?? null;
  const selectedIssues = result.cards.find((r) => r.id === selectedId)?.issues ?? [];

  /* ---- 카드 편집 ---- */
  const onCardChange = useCallback((card: Card) => store.setDeck(withCard(deck, card)), [deck, store]);

  const onChangeType = useCallback(
    (next: CardType) => {
      if (!selected) return;
      const { card, dropped } = changeType(selected, next);
      store.setDeck(withCard(deck, card));
      if (dropped.length) say(`형식을 바꾸며 버린 것 — ${dropped.join(" · ")}`);
    },
    [deck, selected, store, say],
  );

  const onAdd = useCallback(
    (type: CardType) => {
      const { deck: next, id } = addCard(deck, type, selectedId ?? undefined);
      store.setDeck(next);
      setSelectedId(id);
      setEditTab("card");
    },
    [deck, selectedId, store],
  );

  const onDuplicate = useCallback(
    (id: number) => {
      const { deck: next, id: fresh } = duplicateCard(deck, id);
      store.setDeck(next);
      setSelectedId(fresh);
    },
    [deck, store],
  );

  const onRemove = useCallback(
    (id: number) => {
      const at = deck.cards.findIndex((c) => c.id === id);
      const next = removeCard(deck, id);
      store.setDeck(next);
      if (selectedId === id) {
        const fallback = next.cards[Math.min(at, next.cards.length - 1)];
        setSelectedId(fallback ? fallback.id : null);
      }
    },
    [deck, selectedId, store],
  );

  /** 검증 메시지가 가리키는 카드로 이동한다 — 메시지의 번호는 덱에서의 순서다. */
  const onSelectByIndex = useCallback(
    (n: number) => {
      const card = deck.cards[n - 1];
      if (!card) return;
      setSelectedId(card.id);
      setEditTab("card");
    },
    [deck],
  );

  const insertImage = useCallback(async () => {
    try {
      if (!HAS_TAURI) return await pickImageDataUri();
      const file = await dialogs.openImage();
      if (!file) return null;
      const uri = await api.readDataUri(file);
      const size = Math.round(uri.length / 1365);
      if (size > 400) say(`${size}KB 그림을 심었다 — 큰 사진이 여럿이면 파일이 무거워진다`);
      return uri;
    } catch (e) {
      say((e as Error).message, "err");
      return null;
    }
  }, [say]);

  /* ---- 파일 ---- */
  const openDeckObject = useCallback(
    (next: Deck, from: string | null) => {
      store.replace(next);
      setPath(from);
      setSelectedId(next.cards[0]?.id ?? null);
      setCategoryFilter("all");
      setEditTab("card");
    },
    [store],
  );

  const onNew = useCallback(() => openDeckObject(emptyDeck(), null), [openDeckObject]);

  const onOpen = useCallback(async () => {
    try {
      if (!HAS_TAURI) {
        const picked = await pickTextFile(".json,application/json");
        if (!picked) return;
        openDeckObject(JSON.parse(picked.text) as Deck, picked.name);
        return say(`${picked.name} 을 열었다`, "ok");
      }
      const file = await dialogs.openDeck();
      if (!file) return;
      openDeckObject(JSON.parse(await api.readText(file)) as Deck, file);
      say(`${file.replace(/^.*\//, "")} 을 열었다`, "ok");
    } catch (e) {
      say(`열지 못했다 — ${(e as Error).message}`, "err");
    }
  }, [openDeckObject, say]);

  const writeOut = useCallback(
    async (target: string | null, name: string, body: string, mime: string) => {
      if (!HAS_TAURI || !target) {
        download(name, body, mime);
        return name;
      }
      const info = await api.writeText(target, body);
      return info.path;
    },
    [],
  );

  const onSaveAs = useCallback(async () => {
    const name = suggestName(deck, ".json");
    const body = JSON.stringify(deck, null, 2) + "\n";
    try {
      const target = HAS_TAURI ? await dialogs.saveDeck(name) : null;
      if (HAS_TAURI && !target) return;
      const at = await writeOut(target, name, body, "application/json");
      if (HAS_TAURI) setPath(at);
      store.markSaved();
      say(`${at.replace(/^.*\//, "")} 에 저장했다`, "ok");
    } catch (e) {
      say(`저장하지 못했다 — ${(e as Error).message}`, "err");
    }
  }, [deck, store, say, writeOut]);

  const onSave = useCallback(async () => {
    if (!HAS_TAURI || !path) return onSaveAs();
    try {
      await api.writeText(path, JSON.stringify(deck, null, 2) + "\n");
      store.markSaved();
      say(`${path.replace(/^.*\//, "")} 에 저장했다`, "ok");
    } catch (e) {
      say(`저장하지 못했다 — ${(e as Error).message}`, "err");
    }
  }, [deck, path, store, say, onSaveAs]);

  const onExportHtml = useCallback(async () => {
    if (!result.ok) return say("검증 오류를 고쳐야 내보낼 수 있다", "err");
    const name = suggestName(deck, ".html");
    try {
      const target = HAS_TAURI ? await dialogs.saveHtml(name) : null;
      if (HAS_TAURI && !target) return;
      const at = await writeOut(target, name, exportHtml, "text/html");
      const bad = checked.lines.filter((l) => !l.ok).length;
      say(
        bad
          ? `${at.replace(/^.*\//, "")} — 기계 검수 ${bad}건 실패다. 검수 탭을 본다`
          : `${at.replace(/^.*\//, "")} (${Math.round(exportHtml.length / 1024)}KB) — 검수 통과`,
        bad ? "err" : "ok",
      );
    } catch (e) {
      say(`내보내지 못했다 — ${(e as Error).message}`, "err");
    }
  }, [checked, deck, exportHtml, result.ok, say, writeOut]);

  const onExportCsv = useCallback(async () => {
    const name = suggestName(deck, ".csv");
    try {
      const target = HAS_TAURI ? await dialogs.saveCsv(name) : null;
      if (HAS_TAURI && !target) return;
      const at = await writeOut(target, name, FCD.toCsv(deck), "text/csv");
      say(`${at.replace(/^.*\//, "")} 로 내보냈다`, "ok");
    } catch (e) {
      say(`내보내지 못했다 — ${(e as Error).message}`, "err");
    }
  }, [deck, say, writeOut]);

  /* ---- 단축키 ---- */
  const saveRef = useRef(onSave);
  const openRef = useRef(onOpen);
  saveRef.current = onSave;
  openRef.current = onOpen;
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const mod = e.metaKey || e.ctrlKey;
      if (!mod) return;
      const k = e.key.toLowerCase();
      if (k === "s") {
        e.preventDefault();
        void saveRef.current();
      } else if (k === "o") {
        e.preventDefault();
        void openRef.current();
      } else if (k === "z" && !e.shiftKey) {
        e.preventDefault();
        store.undo();
      } else if ((k === "z" && e.shiftKey) || k === "y") {
        e.preventDefault();
        store.redo();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [store]);

  /* ---- 가져오기 ---- */
  const onImport = useCallback(
    (cards: Card[], mode: "append" | "replace") => {
      const merged =
        mode === "replace"
          ? { ...deck, cards }
          : { ...deck, cards: [...deck.cards, ...cards] };
      /* 가져온 카드의 id 는 1부터라 기존 id 와 부딪힌다 — 합친 뒤 다시 매긴다 */
      const next = renumberCards(merged);
      store.setDeck(next);
      setSelectedId(next.cards[mode === "replace" ? 0 : deck.cards.length]?.id ?? null);
      setEditTab("card");
      say(`카드 ${cards.length}장을 ${mode === "replace" ? "덱 교체로" : "이어붙여"} 가져왔다`, "ok");
    },
    [deck, store, say],
  );

  const editTabs: { key: EditTab; label: string; count?: number }[] = [
    { key: "card", label: "카드" },
    { key: "deck", label: "덱 설정" },
    { key: "json", label: "JSON" },
    { key: "import", label: "가져오기" },
    { key: "examples", label: "예제", count: EXAMPLES.length },
    { key: "docs", label: "문서" },
    { key: "skill", label: "스킬" },
  ];

  return (
    <div className="app">
      <Toolbar
        deck={deck}
        path={path}
        dirty={store.dirty}
        canUndo={store.canUndo}
        canRedo={store.canRedo}
        valid={result.ok}
        onNew={onNew}
        onOpen={() => void onOpen()}
        onSave={() => void onSave()}
        onSaveAs={() => void onSaveAs()}
        onExportHtml={() => void onExportHtml()}
        onExportCsv={() => void onExportCsv()}
        onUndo={store.undo}
        onRedo={store.redo}
      />

      <div className="app-body">
        <div className="app-col">
          <CardList
            deck={deck}
            rows={result.cards}
            selectedId={selectedId}
            onSelect={setSelectedId}
            onAdd={onAdd}
            onDuplicate={onDuplicate}
            onRemove={onRemove}
            onMove={(id, delta) => store.setDeck(moveCard(deck, id, delta))}
            categoryFilter={categoryFilter}
            onCategoryFilter={setCategoryFilter}
          />
        </div>

        <div className="app-col">
          <div className="tabs">
            {editTabs.map((t) => (
              <button
                key={t.key}
                className={`tab${editTab === t.key ? " active" : ""}`}
                onClick={() => setEditTab(t.key)}
              >
                {t.label}
                {t.count == null ? null : <span className="count">{t.count}</span>}
              </button>
            ))}
          </div>
          <div className="grow scroll">
            {editTab === "card" ? (
              <CardForm
                card={selected}
                issues={selectedIssues}
                onChange={onCardChange}
                onChangeType={onChangeType}
                onInsertImage={insertImage}
              />
            ) : null}
            {editTab === "deck" ? (
              <DeckSettings
                deck={deck}
                stats={result.stats}
                onPatch={(patch) => store.setDeck(patchDeck(deck, patch))}
              />
            ) : null}
            {editTab === "json" ? (
              <JsonEditor deck={deck} onApply={(next) => openDeckObject(next, path)} />
            ) : null}
            {editTab === "import" ? <ImportPanel onImport={onImport} onToast={say} /> : null}
            {editTab === "examples" ? (
              <ExamplesPanel
                onOpen={(next) => {
                  openDeckObject(next, null);
                  say(`${next.title} 예제를 열었다`, "ok");
                }}
              />
            ) : null}
            {editTab === "docs" ? <DocsPanel /> : null}
            {editTab === "skill" ? <SkillPanel onToast={say} /> : null}
          </div>
        </div>

        <div className="app-col">
          <div className="tabs">
            <button
              className={`tab${viewTab === "preview" ? " active" : ""}`}
              onClick={() => setViewTab("preview")}
            >
              미리보기
            </button>
            <button
              className={`tab${viewTab === "validate" ? " active" : ""}`}
              onClick={() => setViewTab("validate")}
            >
              검증
              <span className="count">
                {result.errors.length ? `✗${result.errors.length}` : ""}
                {result.warnings.length ? ` !${result.warnings.length}` : ""}
                {result.errors.length + result.warnings.length ? "" : "✓"}
              </span>
            </button>
            <button
              className={`tab${viewTab === "check" ? " active" : ""}`}
              onClick={() => setViewTab("check")}
            >
              검수
              <span className="count">{checked.fail ? `✗${checked.fail}` : "✓"}</span>
            </button>
          </div>
          {/* 미리보기 iframe 은 탭을 옮겨도 살려 둔다 — 다시 만들면 학습 진행이 처음으로 돌아간다 */}
          <div className="grow" style={{ display: viewTab === "preview" ? "flex" : "none", flexDirection: "column", minHeight: 0 }}>
            <Preview html={previewHtml} selectedId={selectedId} onError={(m) => say(m, "err")} />
          </div>
          {viewTab === "validate" ? (
            <div className="grow scroll">
              <ValidatePanel result={result} onSelect={onSelectByIndex} />
            </div>
          ) : null}
          {viewTab === "check" ? (
            <div className="grow scroll">
              <CheckPanel result={checked} />
            </div>
          ) : null}
        </div>
      </div>

      {toast ? <div className={`toast ${toast.kind}`}>{toast.msg}</div> : null}
    </div>
  );
}
