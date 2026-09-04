/**
 * 카드 목록 — 행 번호가 곧 검증 메시지의 "카드 N" 이다.
 *
 * 칩 필터와 퀴즈 배지는 엔진이 준 `rows` 만 근거로 그린다. 여기서 카드를 다시 순회해
 * 세면 화면이 산출물(base.html 의 renderChips · quizModeOf) 과 어긋나 배지가 거짓말을 한다.
 *
 * 검색·정렬·다중 선택은 전부 이 컴포넌트의 보기 상태다 — 덱을 바꾸지 않으므로
 * 실행 취소 타임라인에 오르지 않고, 다른 패널이 알 필요도 없다. 검색·정렬 중에도
 * 행 번호는 덱 순서(`r.n`) 그대로다. 그래야 검증 메시지의 "카드 N" 을 찾을 수 있다.
 */
import { useEffect, useId, useState, type DragEvent, type MouseEvent } from "react";
import { FCD } from "../engine/boot";
import type { Card, CardRow, CardType, Deck } from "../engine/types";

/** 엔진 `row.quiz` 세 값의 표시 이름. */
const QUIZ_LABEL: Record<"choice" | "typing" | "blank", string> = {
  choice: "객관식",
  typing: "주관식",
  blank: "빈칸",
};

/** 추가 버튼에 세울 형식 목록. 엔진이 아는 형식만 만들 수 있다. */
const TYPES = Object.keys(FCD.CARD_TYPES ?? {}) as CardType[];

type Sort = "order" | "type" | "category" | "bad" | "chars";

const SORT_LABEL: Record<Sort, string> = {
  order: "순서",
  type: "형식",
  category: "카테고리",
  bad: "오류 먼저",
  chars: "글자수 많은 순",
};

const LOCKED = "정렬 중에는 순서를 바꿀 수 없다 — 정렬을 '순서' 로 되돌린다";

/** 놓을 자리. `end` 는 목록 아래 빈 공간 — 맨 뒤로. */
type DropAt = { n: number; where: "before" | "after" } | { where: "end" };

/** 카드 한 장의 검색 본문. markdown 기호를 벗겨야 `**답**` 이 "답" 으로 잡힌다. */
function searchText(card: Card | undefined, row: CardRow): string {
  if (!card) return row.label.toLowerCase();
  const parts = [card.front, card.back, card.text, card.note, card.context, card.category];
  if (card.items) parts.push(card.items.join("\n"));
  return FCD.plain(parts.filter(Boolean).join("\n")).toLowerCase();
}

function compareRows(sort: Sort, a: CardRow, b: CardRow): number {
  let d = 0;
  if (sort === "type") d = TYPES.indexOf(a.type) - TYPES.indexOf(b.type);
  else if (sort === "category") {
    /* 카테고리 없는 카드는 맨 뒤 — 이름순 사이에 끼면 "빈 이름" 처럼 보인다 */
    if (!a.category !== !b.category) d = a.category ? -1 : 1;
    else d = (a.category ?? "").localeCompare(b.category ?? "", "ko");
  } else if (sort === "bad") d = b.issues.length - a.issues.length;
  else if (sort === "chars") d = b.chars - a.chars;
  return d || a.n - b.n;
}

export function CardList({
  deck,
  rows,
  selectedId,
  onSelect,
  onAdd,
  onDuplicate,
  onRemove,
  onMove,
  onReorder,
  onRemoveMany,
  onSetCategory,
  onRenameCategory,
  categoryFilter,
  onCategoryFilter,
}: {
  deck: Deck;
  rows: CardRow[];
  selectedId: number | null;
  onSelect: (id: number) => void;
  onAdd: (type: CardType) => void;
  onDuplicate: (id: number) => void;
  onRemove: (id: number) => void;
  onMove: (id: number, delta: number) => void;
  /** 드래그 놓기 — `toIndex` 는 덱 순서 기준 */
  onReorder: (id: number, toIndex: number) => void;
  onRemoveMany: (ids: number[]) => void;
  /** `category` 가 '' 이면 카테고리 제거 */
  onSetCategory: (ids: number[], category: string) => void;
  onRenameCategory: (from: string, to: string) => void;
  categoryFilter: string;
  onCategoryFilter: (cat: string) => void;
}) {
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<Sort>("order");
  /* 다중 선택은 `selectedId`(편집 중인 한 장) 와 별개다. anchor 는 ⇧클릭 범위의 출발점 */
  const [picked, setPicked] = useState<Set<number>>(() => new Set());
  const [anchor, setAnchor] = useState<number | null>(null);
  const [bulkCat, setBulkCat] = useState("");
  const [renaming, setRenaming] = useState<{ from: string; value: string } | null>(null);
  const [dragId, setDragId] = useState<number | null>(null);
  const [dropAt, setDropAt] = useState<DropAt | null>(null);
  const catListId = useId();

  /* 카테고리는 나온 순서를 지킨다 — 산출물 칩도 DECK 순서로 붙는다 */
  const counts = new Map<string, number>();
  for (const r of rows) if (r.category) counts.set(r.category, (counts.get(r.category) ?? 0) + 1);

  /* 산출물은 카테고리가 2종 이상일 때만 칩을 그린다 — 화면도 같은 문턱을 쓴다 */
  const hasChips = counts.size >= 2;
  const cat = hasChips ? categoryFilter : "all";
  const q = query.trim().toLowerCase();
  let shown = cat === "all" ? rows : rows.filter((r) => r.category === cat);
  if (q) shown = shown.filter((r) => searchText(deck.cards[r.n - 1], r).includes(q));
  if (sort !== "order") shown = shown.slice().sort((a, b) => compareRows(sort, a, b));

  /* quiz: "off" 면 엔진도 제외 장수를 세지 않는다 — 덱 전체가 빠진 상태라 배지가 정보가 못 된다 */
  const quizOn = (deck.quiz ?? "auto") !== "off";
  const locked = sort !== "order";

  /* 지워진 카드가 선택에 남으면 "N장 선택" 이 거짓이 된다 */
  useEffect(() => {
    if (picked.size === 0) return;
    const alive = new Set<number>();
    for (const c of deck.cards) if (picked.has(c.id)) alive.add(c.id);
    if (alive.size !== picked.size) setPicked(alive);
  }, [deck.cards, picked]);

  function clickRow(e: MouseEvent, id: number) {
    if (e.shiftKey) {
      /* 범위는 지금 보이는 순서로 — 정렬·검색 중에 덱 순서로 잡으면 안 보이는 카드가 끼어든다 */
      const ids = shown.map((r) => r.id).filter((x): x is number => typeof x === "number");
      const from = ids.indexOf(anchor ?? selectedId ?? id);
      const to = ids.indexOf(id);
      const [lo, hi] = from < 0 ? [to, to] : [Math.min(from, to), Math.max(from, to)];
      setPicked(new Set(ids.slice(lo, hi + 1)));
      return;
    }
    if (e.metaKey || e.ctrlKey) {
      const next = new Set(picked);
      /* 첫 ⌘클릭은 편집 중인 카드와 짝을 이룬다 — 그래야 두 번째 클릭에 바로 2장이 된다 */
      if (next.size === 0 && selectedId !== null && selectedId !== id) next.add(selectedId);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      setPicked(next);
      setAnchor(id);
      return;
    }
    if (picked.size) setPicked(new Set());
    setAnchor(id);
    onSelect(id);
  }

  function clearPicked() {
    setPicked(new Set());
    setBulkCat("");
  }

  /**
   * 놓기 → 덱 인덱스. 대상 행 `t` 의 덱 인덱스에서 끌던 카드를 뺀 뒤의 자리를 구하고
   * "뒤" 면 하나 더한다. 필터·검색으로 사이 카드가 안 보여도 "대상 카드 앞/뒤" 라는 뜻은 같다.
   */
  function dropIndex(at: DropAt, fromIndex: number): number {
    if (at.where === "end") return deck.cards.length - 1;
    const t = at.n - 1;
    /* 제자리에 놓기 — "뒤" 로 계산하면 한 칸 밀리므로 먼저 걸러낸다 */
    if (t === fromIndex) return fromIndex;
    const shifted = t > fromIndex ? t - 1 : t;
    return at.where === "after" ? shifted + 1 : shifted;
  }

  function finishDrop() {
    const at = dropAt;
    const id = dragId;
    setDragId(null);
    setDropAt(null);
    if (id === null || !at) return;
    const from = deck.cards.findIndex((c) => c.id === id);
    if (from >= 0) onReorder(id, dropIndex(at, from));
  }

  function overRow(e: DragEvent, r: CardRow) {
    if (dragId === null) return;
    e.preventDefault();
    e.stopPropagation();
    e.dataTransfer.dropEffect = "move";
    if (r.id === dragId) {
      /* 끌던 카드 위 — 놓아도 제자리니 표시선을 그리지 않는다 */
      if (dropAt) setDropAt(null);
      return;
    }
    const box = e.currentTarget.getBoundingClientRect();
    const where = e.clientY < box.top + box.height / 2 ? "before" : "after";
    if (!dropAt || dropAt.where === "end" || dropAt.n !== r.n || dropAt.where !== where) {
      setDropAt({ n: r.n, where });
    }
  }

  function overList(e: DragEvent) {
    if (dragId === null) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    if (!dropAt || dropAt.where !== "end") setDropAt({ where: "end" });
  }

  function commitRename() {
    if (!renaming) return;
    const to = renaming.value.trim();
    setRenaming(null);
    /* 보고 있던 칩의 필터 갱신은 App 이 한다 — 필터 상태의 주인이기 때문이다 */
    if (to !== renaming.from) onRenameCategory(renaming.from, to);
  }

  const pickedIds = [...picked];
  const bulk = picked.size >= 2;

  return (
    <div className="panel grow">
      {/* 목록 칼럼은 264px 다 — 형식 이름 세 개가 한 줄에 들어가지 않아 접히게 둔다 */}
      <div className="panel-head" style={{ flexWrap: "wrap" }}>
        <span>카드</span>
        <span className="muted">{deck.cards.length}장</span>
        <span className="spacer" />
        {TYPES.map((t) => (
          <button
            key={t}
            type="button"
            className="btn sm"
            title={FCD.CARD_TYPES[t].use}
            onClick={() => onAdd(t)}
          >
            + {FCD.CARD_TYPES[t].label}
          </button>
        ))}
      </div>

      <div className="list-tools">
        <input
          className="input"
          placeholder="검색 — 앞·뒤·빈칸·보충"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Escape") {
              setQuery("");
              e.currentTarget.blur();
            }
          }}
        />
        {q && (
          <span className="list-count" title="보이는 카드 / 전체">
            {shown.length} / {rows.length}
          </span>
        )}
        <select
          className="select"
          title="보기 순서 — 덱 순서는 바뀌지 않는다"
          value={sort}
          onChange={(e) => setSort(e.target.value as Sort)}
        >
          {(Object.keys(SORT_LABEL) as Sort[]).map((s) => (
            <option key={s} value={s}>
              {SORT_LABEL[s]}
            </option>
          ))}
        </select>
      </div>

      {bulk && (
        <div className="bulk">
          <strong>{picked.size}장 선택</strong>
          <input
            className="input"
            list={catListId}
            placeholder="카테고리"
            value={bulkCat}
            onChange={(e) => setBulkCat(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && bulkCat.trim()) onSetCategory(pickedIds, bulkCat);
              if (e.key === "Escape") clearPicked();
            }}
          />
          <datalist id={catListId}>
            {[...counts.keys()].map((name) => (
              <option key={name} value={name} />
            ))}
          </datalist>
          <button
            type="button"
            className="btn sm"
            title="선택한 카드에 이 카테고리를 붙인다"
            disabled={!bulkCat.trim()}
            onClick={() => onSetCategory(pickedIds, bulkCat)}
          >
            적용
          </button>
          <button
            type="button"
            className="btn sm ghost"
            title="선택한 카드의 카테고리를 뗀다"
            onClick={() => onSetCategory(pickedIds, "")}
          >
            카테고리 제거
          </button>
          <button
            type="button"
            className="btn sm danger"
            title="선택한 카드를 지운다 — ⌘Z 로 되돌린다"
            onClick={() => {
              onRemoveMany(pickedIds);
              clearPicked();
            }}
          >
            삭제
          </button>
          <button type="button" className="btn sm ghost" title="선택 해제" onClick={clearPicked}>
            해제
          </button>
        </div>
      )}

      {hasChips && (
        <div className="panel-body">
          <div className="row tight" style={{ flexWrap: "wrap" }}>
            <button
              type="button"
              className={"chip" + (cat === "all" ? " active" : "")}
              onClick={() => onCategoryFilter("all")}
            >
              전체 {deck.cards.length}
            </button>
            {[...counts].map(([name, n]) =>
              renaming?.from === name ? (
                <input
                  key={name}
                  className="chip-edit"
                  autoFocus
                  value={renaming.value}
                  title="Enter 로 이름 바꾸기 · Esc 취소 · 비우면 카테고리 제거"
                  onChange={(e) => setRenaming({ from: name, value: e.target.value })}
                  onBlur={commitRename}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") commitRename();
                    else if (e.key === "Escape") setRenaming(null);
                  }}
                />
              ) : (
                <button
                  key={name}
                  type="button"
                  className={"chip" + (cat === name ? " active" : "")}
                  title="더블클릭으로 이름 바꾸기"
                  onClick={() => onCategoryFilter(name)}
                  onDoubleClick={() => setRenaming({ from: name, value: name })}
                >
                  {name} {n}
                </button>
              ),
            )}
          </div>
        </div>
      )}

      <div
        className="grow scroll"
        onDragOver={overList}
        onDrop={(e) => {
          e.preventDefault();
          finishDrop();
        }}
        onDragLeave={(e) => {
          /* 자식 사이를 오갈 때도 leave 가 뜬다 — 진짜 밖으로 나갔을 때만 표시선을 지운다 */
          if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setDropAt(null);
        }}
      >
        {shown.length === 0 ? (
          <div className="list-empty">
            {rows.length === 0
              ? "카드가 없다 — 위에서 형식을 골라 첫 장을 만든다"
              : q
                ? `"${query.trim()}" 에 맞는 카드가 없다`
                : `"${cat}" 카테고리에 카드가 없다`}
          </div>
        ) : (
          <div className={"list" + (dropAt?.where === "end" ? " drop-end" : "")}>
            {shown.map((r) => {
              /* 손으로 고친 JSON 은 id 가 없을 수 있다. 그 카드는 지목할 수 없어 도구를 잠근다 */
              const id = typeof r.id === "number" && Number.isFinite(r.id) ? r.id : null;
              const bad = r.issues.length > 0;
              const canDrag = id !== null && !locked;
              const drop = dropAt && dropAt.where !== "end" && dropAt.n === r.n ? dropAt.where : null;
              return (
                <div
                  key={r.n}
                  className={
                    "card-row" +
                    (id !== null && id === selectedId ? " active" : "") +
                    (id !== null && picked.has(id) ? " picked" : "") +
                    (bad ? " bad" : "") +
                    (id !== null && id === dragId ? " dragging" : "") +
                    (drop ? ` drop-${drop}` : "")
                  }
                  title={
                    id === null
                      ? "id 가 없어 지목할 수 없다 — 번호 다시 매기기로 고친다"
                      : locked
                        ? LOCKED
                        : undefined
                  }
                  draggable={canDrag}
                  onDragStart={(e) => {
                    if (!canDrag) return;
                    e.dataTransfer.effectAllowed = "move";
                    /* 빈 dataTransfer 는 일부 WebView 가 드래그를 시작하지 않는다 */
                    e.dataTransfer.setData("text/plain", String(id));
                    setDragId(id);
                  }}
                  onDragEnd={() => {
                    setDragId(null);
                    setDropAt(null);
                  }}
                  onDragOver={(e) => overRow(e, r)}
                  onDrop={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    finishDrop();
                  }}
                  onMouseDown={(e) => {
                    /* ⇧클릭은 범위 선택이다 — 브라우저의 글자 선택이 겹쳐 파랗게 칠하면 헷갈린다 */
                    if (e.shiftKey) e.preventDefault();
                  }}
                  onClick={(e) => id !== null && clickRow(e, id)}
                >
                  <div className="card-row-n">{r.n}</div>
                  <div className="card-row-main">
                    <div className="card-row-label">{r.label}</div>
                    <div className="card-row-meta">
                      <span className="badge mute">{FCD.CARD_TYPES[r.type]?.label ?? r.type}</span>
                      {r.category && <span>{r.category}</span>}
                      {quizOn &&
                        (r.quiz ? (
                          <span className="badge">{QUIZ_LABEL[r.quiz]}</span>
                        ) : (
                          <span className="badge mute">퀴즈 제외</span>
                        ))}
                      {bad && <span className="badge err">오류 {r.issues.length}</span>}
                    </div>
                  </div>
                  {/*
                   * 목록이 좁아 도구는 기호로 둔다 — 이름은 title 이 말한다.
                   * 배지가 도구 자리까지 흘러들므로 행의 배경을 물려받아 가린다. 도구는 hover·선택에서만
                   * 드러나니(styles.css) 평소에는 배지가 그 자리를 그대로 쓴다.
                   */}
                  <div
                    className="card-row-tools"
                    style={{ background: "inherit" }}
                    onClick={(e) => e.stopPropagation()}
                  >
                    <button
                      type="button"
                      className="btn sm ghost"
                      title={locked ? LOCKED : "위로"}
                      disabled={id === null || locked || r.n === 1}
                      onClick={() => id !== null && onMove(id, -1)}
                    >
                      ↑
                    </button>
                    <button
                      type="button"
                      className="btn sm ghost"
                      title={locked ? LOCKED : "아래로"}
                      disabled={id === null || locked || r.n === rows.length}
                      onClick={() => id !== null && onMove(id, 1)}
                    >
                      ↓
                    </button>
                    <button
                      type="button"
                      className="btn sm ghost"
                      title="복제"
                      disabled={id === null}
                      onClick={() => id !== null && onDuplicate(id)}
                    >
                      ⧉
                    </button>
                    <button
                      type="button"
                      className="btn sm danger"
                      title="삭제 — ⌘Z 로 되돌린다"
                      disabled={id === null}
                      onClick={() => id !== null && onRemove(id)}
                    >
                      ×
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
