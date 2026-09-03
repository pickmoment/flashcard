/**
 * 덱 루트 설정 — 값을 내부 상태로 복제하지 않고 바로 `onPatch` 로 올린다.
 * 복제하면 실행 취소·JSON 편집으로 덱이 밖에서 바뀔 때 폼이 낡은 값을 붙든다.
 *
 * 선택 목록(퀴즈 모드 · 포인트색 · 비율) 은 전부 엔진 카탈로그에서 읽는다.
 */
import { useState } from "react";
import { FCD } from "../engine/boot";
import type { Deck, DeckStats, QuizMode } from "../engine/types";

/** 여섯 자리가 다 차야 색이다 — 이 앞의 초안은 덱에 올리지 않는다. */
const HEX6 = /^#[0-9a-fA-F]{6}$/;

export function DeckSettings({
  deck,
  stats,
  onPatch,
}: {
  deck: Deck;
  stats: DeckStats;
  onPatch: (patch: Partial<Deck>) => void;
}) {
  /* 생략된 값의 기본은 엔진 normalize 와 같게 맞춘다 — 폼이 보여주는 값이 산출물의 값이어야 한다 */
  const accent = deck.accent ?? "indigo";
  const quiz: QuizMode = deck.quiz ?? "auto";
  const autoplaySec = deck.autoplaySec ?? 6;
  const pal = FCD.palette(accent);
  const hex = pal ? pal.hex : accent;

  /*
   * HEX 직접 입력만 예외로 초안을 든다. `#ab` 까지 쳤을 때 올려 버리면 알 수 없는 색이 되어
   * 검증 오류가 타이핑 내내 번쩍인다. 6자리가 차면 그때 올린다.
   * 덱의 색이 밖에서 바뀌면(스와치·실행 취소·JSON) 초안을 그 값으로 되돌린다.
   */
  const [box, setBox] = useState({ from: hex, draft: hex });
  if (box.from !== hex) setBox({ from: hex, draft: hex });

  const tiles: { n: number; label: string }[] = [
    { n: stats.cards, label: "카드" },
    { n: stats.types.basic, label: FCD.CARD_TYPES.basic.label },
    { n: stats.types.cloze, label: FCD.CARD_TYPES.cloze.label },
    { n: stats.types.sequence, label: FCD.CARD_TYPES.sequence.label },
    { n: stats.categories.length, label: "카테고리" },
    { n: stats.quiz.choice, label: "객관식" },
    { n: stats.quiz.typing, label: "주관식" },
    { n: stats.quiz.blank, label: "빈칸 출제" },
    { n: stats.excludedFromQuiz, label: "퀴즈 제외" },
    { n: stats.mermaid, label: "mermaid" },
    { n: stats.images, label: "이미지" },
    { n: stats.clozeBlanks, label: "빈칸 총 개수" },
  ];

  return (
    <div className="panel-body">
      <div className="field">
        <label className="field-label">
          제목 <span className="req">*</span>
        </label>
        <input
          className="input"
          value={deck.title}
          placeholder="자바스크립트 클로저"
          onChange={(e) => onPatch({ title: e.target.value })}
        />
      </div>

      <div className="field">
        <label className="field-label">부제</label>
        <input
          className="input"
          value={deck.subtitle ?? ""}
          placeholder="면접 대비 핵심 12문항"
          onChange={(e) => onPatch({ subtitle: e.target.value })}
        />
      </div>

      <div className="field">
        <label className="field-label">
          id <span className="req">*</span>
        </label>
        <input
          className="input mono"
          value={deck.id}
          placeholder="js-closure"
          onChange={(e) => onPatch({ id: e.target.value })}
        />
        <p className="field-hint">localStorage 키다. 내용을 크게 바꾸면 -v2 로 올린다</p>
      </div>

      <div className="field">
        <label className="field-label">퀴즈</label>
        <select
          className="select"
          value={quiz}
          onChange={(e) => onPatch({ quiz: e.target.value as QuizMode })}
        >
          {Object.entries(FCD.QUIZ_MODES).map(([k, why]) => (
            <option key={k} value={k}>
              {k} — {why}
            </option>
          ))}
        </select>
        <p className="field-hint">{FCD.QUIZ_MODES[quiz]}</p>
      </div>

      <div className="field">
        <label className="check">
          <input
            type="checkbox"
            checked={deck.story === true}
            onChange={(e) => onPatch({ story: e.target.checked })}
          />
          스토리라인 덱
        </label>
        <p className="field-hint">셔플 기본 OFF + 섞을 때 경고 배지</p>
      </div>

      <div className="field">
        <label className="check">
          <input
            type="checkbox"
            checked={deck.reverse === true}
            onChange={(e) => onPatch({ reverse: e.target.checked })}
          />
          양방향 (앞↔뒤 전환)
        </label>
        <p className="field-hint">basic 카드에만 의미가 있다</p>
      </div>

      <div className="field">
        <label className="field-label">자동재생 간격 (초)</label>
        <input
          className="input"
          type="number"
          min={1}
          max={120}
          value={autoplaySec}
          onChange={(e) => {
            const n = Math.round(Number(e.target.value));
            onPatch({ autoplaySec: Number.isFinite(n) ? Math.min(120, Math.max(1, n)) : 6 });
          }}
        />
        <p className="field-hint">
          발표 모드는 공개→다음 두 단계로 도니 {stats.cards}장 한 바퀴 약{" "}
          {(stats.autoplayTotalSec / 60).toFixed(1)}분 ({stats.autoplayTotalSec}초)
        </p>
      </div>

      <div className="field">
        <label className="field-label">포인트색</label>
        <div className="row tight">
          {Object.entries(FCD.ACCENTS).map(([k, a]) => (
            <button
              key={k}
              type="button"
              className={"swatch" + (accent === k ? " active" : "")}
              style={{ background: a.hex }}
              title={`${a.label} ${a.hex}`}
              onClick={() => onPatch({ accent: k })}
            />
          ))}
        </div>
        <div className="row tight">
          <input
            /* 아직 색이 아닌 초안은 붉게 — 눌러도 아무 일이 없는 이유를 그 자리에서 알려준다 */
            className={"input mono" + (HEX6.test(box.draft) ? "" : " bad")}
            style={{ flex: 1 }}
            value={box.draft}
            maxLength={7}
            placeholder="#4f6ef7"
            onChange={(e) => {
              const v = e.target.value.trim();
              setBox({ from: hex, draft: v });
              if (HEX6.test(v)) onPatch({ accent: v.toLowerCase() });
            }}
          />
          {pal ? (
            <span className={"badge" + (pal.contrastLight < 4.5 ? " warn" : "")}>
              흰 카드 위 {pal.contrastLight.toFixed(1)}:1
            </span>
          ) : (
            <span className="badge err">알 수 없는 색</span>
          )}
        </div>
        <p className="field-hint">
          답의 **굵게** 가 이 색으로 나온다 — 흰 카드 위 대비가 4.5:1 아래면 읽히지 않는다
        </p>
      </div>

      <div className="field">
        <label className="field-label">카드 비율</label>
        <div className="row tight">
          {Object.entries(FCD.RATIOS).map(([k, why]) => (
            <button
              key={k}
              type="button"
              className={"chip" + (stats.ratio === k ? " active" : "")}
              title={why}
              onClick={() => onPatch({ ratio: k })}
            >
              {k}
            </button>
          ))}
        </div>
        <p className="field-hint">{FCD.RATIOS[stats.ratio] ?? "목록에 없는 비율이다"}</p>
      </div>

      <div className="field">
        <label className="field-label">덱 통계</label>
        <div className="stats">
          {tiles.map((t) => (
            <div className="stat" key={t.label}>
              <div className="stat-num">{t.n}</div>
              <div className="stat-label">{t.label}</div>
            </div>
          ))}
        </div>
        {stats.categories.length < 2 ? (
          <p className="field-hint">카테고리가 1종 이하다 — 산출물에 칩 필터가 나오지 않는다</p>
        ) : (
          stats.uncategorized > 0 && (
            <p className="field-hint">
              카테고리가 비어 있는 카드 {stats.uncategorized}장은 칩 필터에서 빠진다
            </p>
          )
        )}
      </div>
    </div>
  );
}
