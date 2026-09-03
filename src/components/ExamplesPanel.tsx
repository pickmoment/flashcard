/**
 * 번들 예제 덱.
 *
 * 백지에서 시작하면 형식·퀴즈·카테고리를 다 정하고 나서야 첫 카드를 쓰게 된다.
 * 예제를 열어 고치는 쪽이 언제나 빠르다.
 */
import { useMemo } from "react";
import { EXAMPLES, FCD } from "../engine/boot";
import type { Deck, DeckStats } from "../engine/types";

export function ExamplesPanel(props: { onOpen(deck: Deck): void }) {
  /* 통계는 엔진이 계산한다 — 카드 수·형식 구성을 여기서 따로 세면 산출물과 어긋난다. */
  const rows = useMemo(
    () =>
      EXAMPLES.map((ex) => {
        let stats: DeckStats | null = null;
        try {
          stats = FCD.stats(ex.deck);
        } catch {
          stats = null;
        }
        /* 한 줄로 이어 붙인다 — 조각을 여러 span 으로 두면 좁은 열에서 줄이 엉킨다. */
        const parts: string[] = [];
        if (stats) {
          for (const [type, n] of Object.entries(stats.types)) if (n) parts.push(`${type} ${n}`);
          parts.push(`퀴즈 ${stats.quizMode}`);
          if (stats.categories.length) parts.push(`카테고리 ${stats.categories.length}종`);
        }
        return { ...ex, stats, summary: parts.join(" · ") };
      }),
    [],
  );

  return (
    <div className="panel-body">
      <div className="field-hint">
        백지에서 시작하지 않는다 — 가까운 예제를 열어 카드만 갈아끼우는 쪽이 빠르다.
      </div>
      <div className="list">
        {rows.map((r) => (
          <div
            className="card-row"
            key={r.key}
            /* 예제 객체를 그대로 넘기면 편집이 번들 원본을 오염시킨다 — 구조 복제해 넘긴다. */
            onClick={() => props.onOpen(JSON.parse(JSON.stringify(r.deck)) as Deck)}
          >
            <div className="card-row-n">{r.stats ? r.stats.cards : "?"}</div>
            <div className="card-row-main">
              <div className="card-row-label">{r.deck.title}</div>
              <div className="card-row-meta">
                <span>{r.summary}</span>
              </div>
              <div className="field-hint">{r.note}</div>
            </div>
            {/* card-row-tools 는 hover 에만 보인다 — 예제 목록에서는 버튼이 늘 보여야 한다. */}
            <div className="row tight">
              <button
                type="button"
                className="btn sm primary"
                onClick={(e) => {
                  e.stopPropagation();
                  props.onOpen(JSON.parse(JSON.stringify(r.deck)) as Deck);
                }}
              >
                열기
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
