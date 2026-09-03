/**
 * 카드 한 장의 폼.
 *
 * 필드 목록은 `fieldsFor(type)` 하나에서만 나온다. 폼이 스키마보다 많은 필드를 보여주면
 * 저장할 때 엔진의 `normalizeCard` 가 그 값을 조용히 버려서, 사용자는 적은 내용이
 * 산출물에 없는 이유를 알 수 없다.
 */
import { FCD } from "../engine/boot";
import { fieldsFor, type FieldSpec } from "../engine/schema";
import type { Card, CardType } from "../engine/types";
import { FieldRenderer } from "./fields/FieldRenderer";

/**
 * 오류 문장이 가리키는 필드를 문장 안의 낱말로 되짚는 표.
 *
 * 엔진은 오류에 필드 이름을 따로 달아 주지 않는다 — 어느 입력이 빨개져야 하는지는
 * 문장에서 읽어내는 수밖에 없다.
 */
const ISSUE_FIELD: Record<string, RegExp> = {
  front: /front|앞면/,
  back: /back|뒷면/,
  text: /text|빈칸/,
  items: /items|항목|단계/,
};

export function CardForm({
  card,
  issues,
  onChange,
  onChangeType,
  onInsertImage,
}: {
  card: Card | null;
  /** 이 카드의 검증 오류 — 엔진 문장 그대로 */
  issues: string[];
  onChange: (card: Card) => void;
  onChangeType: (next: CardType) => void;
  /** 이미지를 data URI 로 돌려준다. 없으면 삽입 버튼을 숨긴다 */
  onInsertImage?: () => Promise<string | null>;
}) {
  if (!card) {
    return <div className="list-empty">왼쪽 목록에서 카드를 고른다</div>;
  }

  const badId = issues.some((m) => /\bid\b/.test(m));

  const setField = (spec: FieldSpec, value: string | string[]) => {
    const bag: Record<string, unknown> = { ...card };
    const empty = typeof value === "string" ? value === "" : value.length === 0;
    // 빈 값은 키째로 지운다 — 다만 필수 필드는 빈 채로 남겨야 검증이 "없다" 고 말한다
    if (empty && !spec.required) delete bag[spec.key];
    else bag[spec.key] = value;
    // 키 순서를 CARD_KEYS 로 되돌린다 — JSON 탭과 내보낸 파일의 diff 가 흔들리지 않게
    onChange(FCD.orderKeys(bag as unknown as Card));
  };

  const frontChars = FCD.plain(
    (card.type === "cloze" ? card.text : card.front) ?? "",
  ).length;
  const backSentences = card.type === "basic" ? FCD.sentences(card.back ?? "") : 0;
  const blanks = card.type === "cloze" ? FCD.clozeAnswers(card.text ?? "").length : 0;
  /**
   * 출제 가능 여부만 본다. 객관식이냐 주관식이냐는 다른 카드의 답이 몇 개인지에
   * 달려 있어 카드 하나만 보고는 말할 수 없다 — 그건 검증 패널이 덱 전체로 센다.
   */
  const quizable = FCD.quizModeOf([card], card, "auto") !== null;
  const typeDef = FCD.CARD_TYPES[card.type];

  return (
    <div className="col">
      <div className="row">
        <span className={badId ? "badge err" : "mono muted"}>id {card.id}</span>
        <span className="spacer" />
        <span
          className={frontChars > 90 ? "badge warn" : "badge"}
          title={frontChars > 90 ? "발표 모드에서 글자가 축소된다. 짧은 질문이 크게 나온다" : "앞면 글자수"}
        >
          앞면 {frontChars}자
        </span>
        {card.type === "basic" && (
          <span
            className={backSentences > 3 ? "badge warn" : "badge"}
            title={backSentences > 3 ? "3문장을 넘으면 카드를 쪼갠다" : "뒷면 문장 수"}
          >
            뒷면 {backSentences}문장
          </span>
        )}
        {card.type === "cloze" && <span className="badge">빈칸 {blanks}개</span>}
        <span
          className={quizable ? "badge ok" : "badge mute"}
          title={
            quizable
              ? "퀴즈 탭에 나온다"
              : "출제에서 빠진다 — 순서 배열·mermaid·빈 답·빈칸 없는 문장은 낼 수 없다"
          }
        >
          {quizable ? "퀴즈 출제" : "퀴즈 제외"}
        </span>
      </div>

      <div className="field">
        <label className="field-label">형식</label>
        <select
          className="select"
          value={card.type}
          onChange={(e) => onChangeType(e.target.value as CardType)}
        >
          {Object.entries(FCD.CARD_TYPES).map(([key, def]) => (
            <option key={key} value={key}>
              {def.label} ({key})
            </option>
          ))}
        </select>
        <p className="field-hint">{typeDef ? typeDef.use : "모르는 형식이다 — JSON 탭에서 고친다"}</p>
      </div>

      {issues.map((m, i) => (
        <div className="diag err" key={i}>
          <span className="diag-mark">✗</span>
          <span>{m}</span>
        </div>
      ))}

      {fieldsFor(card.type).map((spec) => (
        <FieldRenderer
          key={spec.key}
          spec={spec}
          value={card[spec.key]}
          bad={issues.some((m) => ISSUE_FIELD[spec.key]?.test(m))}
          onChange={(value) => setField(spec, value)}
          onInsertImage={onInsertImage}
        />
      ))}
    </div>
  );
}
