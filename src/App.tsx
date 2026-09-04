/**
 * 세 칸 한 화면 — 카드 목록 · 편집 · 실제 산출물.
 *
 * 상태는 여기 하나에 있다(`useDeckStore`). 컴포넌트는 값을 받아 그리고 콜백으로 되돌려주기만
 * 하므로, 같은 덱에 대한 두 개의 진실이 생기지 않는다. 미리보기도 별도 렌더러가 아니라
 * `build(deck, { preview: true })` 로 만든 **실제 산출물**이다 — 화면에서 본 것이 곧 내보낼 파일이다.
 *
 * 문서를 갈아끼우는 길(새 덱·열기·예제·최근·자동 복구)은 전부 `confirmDiscard` 게이트를 지난다.
 * JSON 탭의 "적용" 은 갈아끼우기가 아니라 같은 문서의 편집이라 히스토리에 쌓인다.
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
import type { Card, CardType, CheckResult, Deck } from "./engine/types";
import { autosave, useAutosave } from "./lib/autosave";
import { build, check, suggestName, validate } from "./lib/build";
import { changeType } from "./lib/cardChange";
import {
  addCard,
  duplicateCard,
  emptyDeck,
  moveCard,
  moveCardTo,
  patchDeck,
  removeCards,
  renameCategory,
  renumberCards,
  setCategory,
  withCard,
} from "./lib/deck";
import { recent } from "./lib/recent";
import {
  HAS_TAURI,
  api,
  ask,
  dialogs,
  download,
  onCloseRequest,
  pickImageDataUri,
  pickTextFile,
} from "./lib/tauri";
import { useDeckStore } from "./lib/useDeckStore";

type EditTab = "card" | "deck" | "json" | "import" | "examples" | "docs" | "skill";
type ViewTab = "preview" | "validate" | "check";

interface Toast {
  msg: string;
  kind: "ok" | "err" | "";
  /** 되돌릴 수 있는 조작(삭제) 뒤에 붙는 버튼 */
  action?: { label: string; run(): void };
}

/**
 * 디바운스된 빌드 결과. 타이핑마다 산출물을 만들면 글자를 칠 수 없다 — 검증만 즉시 하고,
 * 문자열 조작이라도 60KB 를 매 키에 만들 이유는 없다.
 */
interface Built {
  /** 내보내기용 산출물 — 검수 대상 */
  html: string;
  checked: CheckResult;
  /** 미리보기 문서(훅 포함). `configKey` 가 같으면 이전 것을 그대로 잇는다 */
  previewHtml: string;
  /** 문서 골격을 정하는 값 — 바뀌면 미리보기를 재빌드, 아니면 카드만 `FCP.update` */
  configKey: string;
  /** DECK 에 실리는 모양의 카드 — 미리보기에 제자리 갱신으로 흘린다 */
  cards: Card[];
  /** 빌드 예외. 산출물은 이전 것을 잇고 원인만 알린다 */
  error: string | null;
}

/**
 * 엔진이 base.html 에 갈아끼우는 자리는 CONFIG · 포인트색 · 비율 · mermaid CDN 유무다 —
 * 그중 카드에서 오는 것은 mermaid 하나뿐이다. 이 키가 같으면 문서를 다시 만들 필요가 없다.
 */
function configKeyOf(deck: Deck): string {
  const { cards, ...rest } = deck;
  return JSON.stringify({ ...rest, mermaid: cards.some((c) => FCD.hasMermaid(c)) });
}

function snapshot(deck: Deck, prev: Built | null): Built {
  const configKey = configKeyOf(deck);
  const cards = FCD.normalize(deck).cards.map((c) => FCD.orderKeys(c));
  try {
    const html = build(deck);
    const previewHtml =
      prev && prev.configKey === configKey && prev.previewHtml
        ? prev.previewHtml
        : build(deck, { preview: true });
    return { html, checked: check(html), previewHtml, configKey, cards, error: null };
  } catch (e) {
    const msg = (e as Error).message;
    const html = `<!-- ${msg} -->`;
    return { html, checked: check(html), previewHtml: prev?.previewHtml ?? "", configKey, cards, error: msg };
  }
}

/** 처음 여는 덱 — 백지보다 예제가 낫다. 무엇을 채워야 하는지가 바로 보인다. */
function firstDeck(): Deck {
  return JSON.parse(JSON.stringify(EXAMPLES[0].deck)) as Deck;
}

const baseName = (p: string) => p.replace(/^.*\//, "");

export default function App() {
  const store = useDeckStore(firstDeck());
  const { deck } = store;

  const [path, setPath] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<number | null>(deck.cards[0]?.id ?? null);
  const [categoryFilter, setCategoryFilter] = useState("all");
  const [editTab, setEditTab] = useState<EditTab>("card");
  const [viewTab, setViewTab] = useState<ViewTab>("preview");
  const [toast, setToast] = useState<Toast | null>(null);

  /* 토스트는 4초 뒤 사라진다(되돌리기 버튼이 있으면 6초 — 읽고 누를 시간). 실패는 앱 로그에도
     남긴다. 번들에서는 콘솔을 열 수 없어 로그 파일이 사후에 원인을 찾는 유일한 자리다. */
  const say = useCallback((msg: string, kind?: "ok" | "err", action?: Toast["action"]) => {
    setToast({ msg, kind: kind ?? "", action });
    if (kind === "err" && HAS_TAURI) void logError(msg);
  }, []);
  const sayErr = useCallback((msg: string) => say(msg, "err"), [say]);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), toast.action ? 6000 : 4200);
    return () => clearTimeout(t);
  }, [toast]);

  /* ---- 검증 · 지연 빌드 ---- */
  const result = useMemo(() => validate(deck), [deck]);

  const [built, setBuilt] = useState<Built>(() => snapshot(deck, null));
  const builtRef = useRef(built);
  builtRef.current = built;
  const deckRef = useRef(deck);
  deckRef.current = deck;

  useEffect(() => {
    const t = setTimeout(() => {
      const next = snapshot(deck, builtRef.current);
      setBuilt(next);
      if (next.error) say(next.error, "err");
    }, 400);
    return () => clearTimeout(t);
  }, [deck, say]);

  /* 미리보기 훅이 `update` 를 모르는 산출물이면 카드 편집마다 문서를 통째로 다시 만든다 */
  const onPreviewStale = useCallback(() => {
    try {
      const previewHtml = build(deckRef.current, { preview: true });
      setBuilt((p) => ({ ...p, previewHtml }));
    } catch {
      /* 산출물이 안 만들어지는 상태 — 디바운스 빌드가 원인을 알린다 */
    }
  }, []);

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

  /** 단건·다건 삭제가 같은 길 — 선택 카드가 지워졌으면 그 자리에 남은 이웃을 고르고, 되돌리기를 띄운다. */
  const onRemoveMany = useCallback(
    (ids: number[]) => {
      const next = removeCards(deck, ids);
      if (next === deck) return;
      store.setDeck(next);
      const gone = new Set(ids);
      if (selectedId != null && gone.has(selectedId)) {
        /* 지운 카드 앞에 남은 카드 수 = 같은 자리에 올라온 이웃의 인덱스 */
        const at = deck.cards.findIndex((c) => c.id === selectedId);
        const before = deck.cards.slice(0, at).filter((c) => !gone.has(c.id)).length;
        const fallback = next.cards[Math.min(before, next.cards.length - 1)];
        setSelectedId(fallback ? fallback.id : null);
      }
      say(`카드 ${deck.cards.length - next.cards.length}장을 지웠다`, undefined, {
        label: "실행 취소",
        run: store.undo,
      });
    },
    [deck, selectedId, store, say],
  );
  const onRemove = useCallback((id: number) => onRemoveMany([id]), [onRemoveMany]);

  const onRenameCategory = useCallback(
    (from: string, to: string) => {
      store.setDeck(renameCategory(deck, from, to));
      if (categoryFilter === from) setCategoryFilter(to);
    },
    [deck, store, categoryFilter],
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

  /** ⌘J/⌘K — 지금 보고 있는 카테고리 안에서 덱 순서로 한 장 이동. */
  const step = useCallback(
    (delta: 1 | -1) => {
      const list =
        categoryFilter === "all"
          ? deck.cards
          : deck.cards.filter((c) => (c.category ?? "").trim() === categoryFilter);
      if (!list.length) return;
      const at = list.findIndex((c) => c.id === selectedId);
      const to = at < 0 ? 0 : Math.max(0, Math.min(list.length - 1, at + delta));
      setSelectedId(list[to].id);
      setEditTab("card");
    },
    [deck, categoryFilter, selectedId],
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
  /* 창 닫기 리스너는 한 번만 달리므로 dirty 는 ref 로 읽는다 */
  const dirtyRef = useRef(store.dirty);
  dirtyRef.current = store.dirty;

  /** 문서를 버리는 조작 앞의 게이트. dirty 가 아니면 묻지 않는다. */
  const confirmDiscard = useCallback(
    () =>
      dirtyRef.current
        ? ask("저장하지 않은 변경이 있다. 버리고 계속할까?", "저장 안 됨")
        : Promise.resolve(true),
    [],
  );

  const openDeckObject = useCallback(
    (next: Deck, from: string | null, opts?: { dirty?: boolean }) => {
      store.replace(next, opts);
      setPath(from);
      setSelectedId(next.cards[0]?.id ?? null);
      setCategoryFilter("all");
      setEditTab("card");
    },
    [store],
  );

  const onNew = useCallback(async () => {
    if (!(await confirmDiscard())) return;
    openDeckObject(emptyDeck(), null);
  }, [confirmDiscard, openDeckObject]);

  /** 경로로 연다 — 열기 다이얼로그와 최근 목록이 같은 길을 지난다. 게이트는 호출부가 먼저 지난다. */
  const openPath = useCallback(
    async (file: string) => {
      try {
        openDeckObject(JSON.parse(await api.readText(file)) as Deck, file);
        void recent.add(file);
        say(`${baseName(file)} 을 열었다`, "ok");
      } catch (e) {
        say(`열지 못했다 — ${(e as Error).message}`, "err");
      }
    },
    [openDeckObject, say],
  );

  const onOpen = useCallback(async () => {
    if (!(await confirmDiscard())) return;
    try {
      if (!HAS_TAURI) {
        const picked = await pickTextFile(".json,application/json");
        if (!picked) return;
        openDeckObject(JSON.parse(picked.text) as Deck, picked.name);
        return say(`${picked.name} 을 열었다`, "ok");
      }
      const file = await dialogs.openDeck();
      if (file) await openPath(file);
    } catch (e) {
      say(`열지 못했다 — ${(e as Error).message}`, "err");
    }
  }, [confirmDiscard, openDeckObject, openPath, say]);

  const onOpenRecent = useCallback(
    async (file: string) => {
      if (await confirmDiscard()) await openPath(file);
    },
    [confirmDiscard, openPath],
  );

  const onOpenExample = useCallback(
    async (next: Deck) => {
      if (!(await confirmDiscard())) return;
      openDeckObject(next, null);
      say(`${next.title} 예제를 열었다`, "ok");
    },
    [confirmDiscard, openDeckObject, say],
  );

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
      if (HAS_TAURI) {
        setPath(at);
        void recent.add(at);
      }
      store.markSaved();
      say(`${baseName(at)} 에 저장했다`, "ok");
    } catch (e) {
      say(`저장하지 못했다 — ${(e as Error).message}`, "err");
    }
  }, [deck, store, say, writeOut]);

  const onSave = useCallback(async () => {
    if (!HAS_TAURI || !path) return onSaveAs();
    try {
      await api.writeText(path, JSON.stringify(deck, null, 2) + "\n");
      store.markSaved();
      void recent.add(path);
      say(`${baseName(path)} 에 저장했다`, "ok");
    } catch (e) {
      say(`저장하지 못했다 — ${(e as Error).message}`, "err");
    }
  }, [deck, path, store, say, onSaveAs]);

  /* 내보내기는 누르는 순간의 덱으로 다시 빌드한다 — 디바운스 중인 400ms 전 산출물을 내보내지 않는다 */
  const onExportHtml = useCallback(async () => {
    if (!result.ok) return say("검증 오류를 고쳐야 내보낼 수 있다", "err");
    const name = suggestName(deck, ".html");
    try {
      const html = build(deck);
      const checked = check(html);
      const target = HAS_TAURI ? await dialogs.saveHtml(name) : null;
      if (HAS_TAURI && !target) return;
      const at = await writeOut(target, name, html, "text/html");
      say(
        checked.fail
          ? `${baseName(at)} — 기계 검수 ${checked.fail}건 실패다. 검수 탭을 본다`
          : `${baseName(at)} (${Math.round(html.length / 1024)}KB) — 검수 통과`,
        checked.fail ? "err" : "ok",
      );
    } catch (e) {
      say(`내보내지 못했다 — ${(e as Error).message}`, "err");
    }
  }, [deck, result.ok, say, writeOut]);

  const onExportCsv = useCallback(async () => {
    const name = suggestName(deck, ".csv");
    try {
      const target = HAS_TAURI ? await dialogs.saveCsv(name) : null;
      if (HAS_TAURI && !target) return;
      const at = await writeOut(target, name, FCD.toCsv(deck), "text/csv");
      say(`${baseName(at)} 로 내보냈다`, "ok");
    } catch (e) {
      say(`내보내지 못했다 — ${(e as Error).message}`, "err");
    }
  }, [deck, say, writeOut]);

  /* ---- 자동 복구 ---- */
  useAutosave(deck, path, store.dirty, sayErr);

  /* 부팅 때 스냅샷이 남아 있으면 마지막 세션이 저장하지 않은 채 끝난 것이다 — 적용 전에 묻는다.
     복구한 내용은 디스크와 다르므로 dirty 로 시작해야 저장을 잊지 않는다. */
  const booted = useRef(false);
  useEffect(() => {
    if (booted.current) return;
    booted.current = true;
    void (async () => {
      try {
        const snap = await autosave.read();
        if (!snap) return;
        const when = new Date(snap.at);
        const at = Number.isNaN(when.getTime()) ? "시각 모름" : when.toLocaleString();
        const where = snap.path ? baseName(snap.path) : "새 덱";
        const yes =
          (await confirmDiscard()) &&
          (await ask(`마지막 세션이 저장되지 않은 채 끝났다 (${at}, ${where}). 복구할까?`, "자동 복구", "복구"));
        if (!yes) return void autosave.clear();
        openDeckObject(snap.deck, snap.path, { dirty: true });
        say(`${where} 을 복구했다 — 디스크에는 아직 없다. 저장한다`, "ok");
      } catch (e) {
        say(`자동 복구 파일을 읽지 못했다 — ${(e as Error).message}`, "err");
      }
    })();
  }, [confirmDiscard, openDeckObject, say]);

  /* 창 닫기 — dirty 면 묻고, 닫기로 했으면 스냅샷을 지워 다음 부팅이 복구를 제안하지 않게 한다 */
  useEffect(
    () =>
      onCloseRequest(
        () => dirtyRef.current,
        async () => {
          if (dirtyRef.current && !(await ask("저장하지 않은 변경이 있다. 버리고 닫을까?", "저장 안 됨", "닫기")))
            return false;
          await autosave.clear().catch(() => undefined);
          return true;
        },
        () => void autosave.clear(),
      ),
    [],
  );

  /* ---- 단축키 ----
     리스너는 한 번만 달고 최신 핸들러는 ref 로 읽는다. 안쪽 편집기(CodeMirror)가 이미 처리한 키는
     defaultPrevented 로 표시되어 있다 — 그건 건너뛰어 편집기의 바인딩과 겹치지 않는다.
     ⌘N·⌘D 는 브라우저가 새 창·북마크로 가로챌 수 있어 preventDefault 를 꼭 부른다. */
  const keys = useRef({ onSave, onOpen, onNew, onAdd, onDuplicate, onRemove, onExportHtml, step, selectedId });
  keys.current = { onSave, onOpen, onNew, onAdd, onDuplicate, onRemove, onExportHtml, step, selectedId };
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const mod = e.metaKey || e.ctrlKey;
      if (!mod || e.defaultPrevented) return;
      const k = e.key.toLowerCase();
      const h = keys.current;
      if (k === "s") {
        e.preventDefault();
        void h.onSave();
      } else if (k === "o") {
        e.preventDefault();
        void h.onOpen();
      } else if (k === "z" && !e.shiftKey) {
        e.preventDefault();
        store.undo();
      } else if ((k === "z" && e.shiftKey) || k === "y") {
        e.preventDefault();
        store.redo();
      } else if (k === "n") {
        e.preventDefault();
        if (e.shiftKey) void h.onNew();
        else h.onAdd("basic");
      } else if (k === "d") {
        e.preventDefault();
        if (h.selectedId != null) h.onDuplicate(h.selectedId);
      } else if (k === "backspace" && e.shiftKey) {
        e.preventDefault();
        if (h.selectedId != null) h.onRemove(h.selectedId);
      } else if (k === "j") {
        e.preventDefault();
        h.step(1);
      } else if (k === "k") {
        e.preventDefault();
        h.step(-1);
      } else if (k === "e") {
        e.preventDefault();
        void h.onExportHtml();
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
        onNew={() => void onNew()}
        onOpen={() => void onOpen()}
        onOpenRecent={(p) => void onOpenRecent(p)}
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
            onReorder={(id, to) => store.setDeck(moveCardTo(deck, id, to))}
            onRemoveMany={onRemoveMany}
            onSetCategory={(ids, cat) => store.setDeck(setCategory(deck, ids, cat))}
            onRenameCategory={onRenameCategory}
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
              <JsonEditor
                deck={deck}
                onApply={(next) => {
                  /* 같은 문서의 편집 — 히스토리에 쌓여 되돌릴 수 있고 dirty 가 된다 */
                  store.setDeck(next);
                  if (!next.cards.some((c) => c.id === selectedId)) setSelectedId(next.cards[0]?.id ?? null);
                }}
              />
            ) : null}
            {editTab === "import" ? <ImportPanel onImport={onImport} onToast={say} /> : null}
            {editTab === "examples" ? <ExamplesPanel onOpen={(next) => void onOpenExample(next)} /> : null}
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
              <span className="count">{built.checked.fail ? `✗${built.checked.fail}` : "✓"}</span>
            </button>
          </div>
          {/* 미리보기 iframe 은 탭을 옮겨도 살려 둔다 — 다시 만들면 학습 진행이 처음으로 돌아간다 */}
          <div className="grow" style={{ display: viewTab === "preview" ? "flex" : "none", flexDirection: "column", minHeight: 0 }}>
            <Preview
              html={built.previewHtml}
              cards={built.cards}
              exportHtml={built.html}
              selectedId={selectedId}
              onError={sayErr}
              onStale={onPreviewStale}
            />
          </div>
          {viewTab === "validate" ? (
            <div className="grow scroll">
              <ValidatePanel result={result} onSelect={onSelectByIndex} />
            </div>
          ) : null}
          {viewTab === "check" ? (
            <div className="grow scroll">
              <CheckPanel result={built.checked} />
            </div>
          ) : null}
        </div>
      </div>

      {toast ? (
        <div className={`toast ${toast.kind}`}>
          {toast.msg}
          {toast.action ? (
            <button
              type="button"
              className="btn sm"
              onClick={() => {
                toast.action?.run();
                setToast(null);
              }}
            >
              {toast.action.label}
            </button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
