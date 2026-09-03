/**
 * 카드 목록 — 행 번호가 곧 검증 메시지의 "카드 N" 이다.
 *
 * 칩 필터와 퀴즈 배지는 엔진이 준 `rows` 만 근거로 그린다. 여기서 카드를 다시 순회해
 * 세면 화면이 산출물(base.html 의 renderChips · quizModeOf) 과 어긋나 배지가 거짓말을 한다.
 */
import { FCD } from "../engine/boot";
import type { CardRow, CardType, Deck } from "../engine/types";

/** 엔진 `row.quiz` 세 값의 표시 이름. */
const QUIZ_LABEL: Record<"choice" | "typing" | "blank", string> = {
  choice: "객관식",
  typing: "주관식",
  blank: "빈칸",
};

/** 추가 버튼에 세울 형식 목록. 엔진이 아는 형식만 만들 수 있다. */
const TYPES = Object.keys(FCD.CARD_TYPES ?? {}) as CardType[];

export function CardList({
  deck,
  rows,
  selectedId,
  onSelect,
  onAdd,
  onDuplicate,
  onRemove,
  onMove,
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
  categoryFilter: string;
  onCategoryFilter: (cat: string) => void;
}) {
  /* 카테고리는 나온 순서를 지킨다 — 산출물 칩도 DECK 순서로 붙는다 */
  const counts = new Map<string, number>();
  for (const r of rows) if (r.category) counts.set(r.category, (counts.get(r.category) ?? 0) + 1);

  /* 산출물은 카테고리가 2종 이상일 때만 칩을 그린다 — 화면도 같은 문턱을 쓴다 */
  const hasChips = counts.size >= 2;
  const cat = hasChips ? categoryFilter : "all";
  const shown = cat === "all" ? rows : rows.filter((r) => r.category === cat);

  /* quiz: "off" 면 엔진도 제외 장수를 세지 않는다 — 덱 전체가 빠진 상태라 배지가 정보가 못 된다 */
  const quizOn = (deck.quiz ?? "auto") !== "off";

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

      {hasChips && (
        <div className="panel-body">
          <div className="row tight">
            <button
              type="button"
              className={"chip" + (cat === "all" ? " active" : "")}
              onClick={() => onCategoryFilter("all")}
            >
              전체 {deck.cards.length}
            </button>
            {[...counts].map(([name, n]) => (
              <button
                key={name}
                type="button"
                className={"chip" + (cat === name ? " active" : "")}
                onClick={() => onCategoryFilter(name)}
              >
                {name} {n}
              </button>
            ))}
          </div>
        </div>
      )}

      <div className="grow scroll">
        {shown.length === 0 ? (
          <div className="list-empty">
            {rows.length === 0
              ? "카드가 없다 — 위에서 형식을 골라 첫 장을 만든다"
              : `"${cat}" 카테고리에 카드가 없다`}
          </div>
        ) : (
          <div className="list">
            {shown.map((r) => {
              /* 손으로 고친 JSON 은 id 가 없을 수 있다. 그 카드는 지목할 수 없어 도구를 잠근다 */
              const id = typeof r.id === "number" && Number.isFinite(r.id) ? r.id : null;
              const bad = r.issues.length > 0;
              return (
                <div
                  key={r.n}
                  className={
                    "card-row" +
                    (id !== null && id === selectedId ? " active" : "") +
                    (bad ? " bad" : "")
                  }
                  title={id === null ? "id 가 없어 지목할 수 없다 — 번호 다시 매기기로 고친다" : undefined}
                  onClick={() => id !== null && onSelect(id)}
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
                      title="위로"
                      disabled={id === null || r.n === 1}
                      onClick={() => id !== null && onMove(id, -1)}
                    >
                      ↑
                    </button>
                    <button
                      type="button"
                      className="btn sm ghost"
                      title="아래로"
                      disabled={id === null || r.n === rows.length}
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
