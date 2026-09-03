/**
 * 카드 편집 스키마 — 폼을 그리는 선언.
 *
 * 필드 목록은 엔진의 `CARD_TYPES[type].fields` 와 같은 순서여야 한다. 폼이 엔진보다
 * 많은 필드를 보여주면 저장할 때 `normalizeCard` 가 조용히 버린다.
 */
import type { CardType } from "./types";

export type FieldKind = "text" | "markdown" | "cloze" | "items" | "choices";

export interface FieldSpec {
  key: "front" | "back" | "text" | "items" | "choices" | "note" | "category" | "context";
  label: string;
  kind: FieldKind;
  /** 비어 있으면 검증에서 오류가 되는 필드 */
  required?: boolean;
  hint?: string;
  rows?: number;
}

/** 형식과 무관하게 항상 편집하는 필드. */
export const COMMON_FIELDS: FieldSpec[] = [
  {
    key: "category",
    label: "카테고리",
    kind: "text",
    hint: "2종 이상일 때만 칩 필터와 배지가 나온다",
  },
  {
    key: "context",
    label: "지금까지 (스토리라인)",
    kind: "text",
    hint: "앞면 상단에 작게 — 이야기 순서 덱에서만",
  },
];

export const NOTE_FIELD: FieldSpec = {
  key: "note",
  label: "보충",
  kind: "markdown",
  hint: "뒷면 하단 작은 글씨. 한 줄로",
  rows: 2,
};

/** 형식별 본문 필드. */
export const TYPE_FIELDS: Record<CardType, FieldSpec[]> = {
  basic: [
    {
      key: "front",
      label: "앞면 — 질문",
      kind: "markdown",
      required: true,
      hint: "짧게. 90자를 넘으면 발표 모드에서 글자가 작아진다",
      rows: 3,
    },
    {
      key: "back",
      label: "뒷면 — 답",
      kind: "markdown",
      required: true,
      hint: "3문장을 넘으면 카드를 쪼갠다. **굵게** 가 포인트색으로 나온다",
      rows: 6,
    },
    {
      key: "choices",
      label: "객관식 오답",
      kind: "choices",
      hint: "비우면 다른 카드의 답에서 자동으로 뽑는다",
    },
  ],
  cloze: [
    {
      key: "text",
      label: "문장 — {{ }} 가 빈칸",
      kind: "cloze",
      required: true,
      hint: "외울 곳을 {{ }} 로 감싼다. 4개를 넘으면 문장이 암호가 된다",
      rows: 5,
    },
  ],
  sequence: [
    {
      key: "front",
      label: "앞면 — 질문",
      kind: "markdown",
      required: true,
      hint: "앞면에는 항목이 섞여 나오고, 뒷면이 올바른 순서다",
      rows: 3,
    },
    {
      key: "items",
      label: "올바른 순서",
      kind: "items",
      required: true,
      hint: "이 순서가 정답이다. 7개를 넘으면 한 카드로 외우기 어렵다",
    },
  ],
};

/** 카드 하나를 편집하는 데 필요한 필드 전체. */
export function fieldsFor(type: CardType): FieldSpec[] {
  return [...COMMON_FIELDS, ...TYPE_FIELDS[type], NOTE_FIELD];
}
