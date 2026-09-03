import { describe, expect, it } from "vitest";
import type { Card } from "../engine/types";
import { validate } from "./build";
import { changeType } from "./cardChange";

/** 바뀐 카드가 산출물에 실릴 수 있는 모양인지 — 필수 필드가 채워졌다는 뜻이다. */
const errorsOf = (card: Card) =>
  validate({ id: "flashcards-test-v1", title: "테스트", cards: [card] }).errors;

const basic: Card = {
  id: 7,
  type: "basic",
  category: "HTTP",
  context: "지금까지: 상태 코드",
  note: "RFC 9110",
  front: "405 는 무슨 뜻인가?",
  back: "메서드가 허용되지 않는다",
};

const cloze: Card = {
  id: 7,
  type: "cloze",
  category: "React",
  text: "상태는 {{useState}} 로 만들고 {{useEffect}} 로 동기화한다",
};

const sequence: Card = {
  id: 7,
  type: "sequence",
  category: "배포",
  front: "배포 순서는?",
  items: ["빌드", "검증", "배포"],
};

describe("changeType", () => {
  it("같은 형식이면 그대로 돌려준다(참조 동일)", () => {
    expect(changeType(basic, "basic").card).toBe(basic);
  });

  it("번호·갈래·맥락·보충은 형식을 가리지 않고 남는다", () => {
    const { card } = changeType(basic, "cloze");
    expect(card).toMatchObject({ id: 7, category: "HTTP", context: "지금까지: 상태 코드", note: "RFC 9110" });
  });

  it("형식에 없는 필드는 남지 않는다", () => {
    const { card } = changeType(basic, "cloze");
    expect("front" in card).toBe(false);
    expect("back" in card).toBe(false);
  });

  it("basic → cloze: 뒷면 문장의 가장 긴 어절이 빈칸이 된다", () => {
    const { card, dropped } = changeType(basic, "cloze");
    expect(card.text).toBe("{{메서드가}} 허용되지 않는다");
    expect(dropped.join(" ")).toContain("앞면");
    expect(errorsOf(card)).toEqual([]);
  });

  it("basic → cloze: 답이 한 낱말이면 질문 뒤에 붙인다", () => {
    const { card } = changeType({ id: 1, type: "basic", front: "1+1 은?", back: "2" }, "cloze");
    expect(card.text).toBe("1+1 은? {{2}}");
    expect(errorsOf(card)).toEqual([]);
  });

  it("basic → cloze: 코드 블록은 빈칸 문장이 될 수 없어 버린다", () => {
    const src: Card = { id: 1, type: "basic", front: "전체 구조는?", back: "```mermaid\ngraph TD\n```" };
    const { card, dropped } = changeType(src, "cloze");
    expect(card.text).toBe("전체 {{구조는}}?");
    expect(dropped.join(" ")).toContain("코드 블록");
    expect(errorsOf(card)).toEqual([]);
  });

  it("basic → cloze: 객관식 오답은 갈 자리가 없어 버렸다고 알린다", () => {
    const src: Card = { ...basic, choices: ["오답1", "오답2"] };
    expect(changeType(src, "cloze").dropped.join(" ")).toContain("객관식 오답 2개");
  });

  it("basic → sequence: 번호 목록·화살표를 단계로 쪼갠다", () => {
    const numbered = changeType({ id: 1, type: "basic", front: "순서는?", back: "1. 씻는다\n2. 자른다\n3. 볶는다" }, "sequence");
    expect(numbered.card.front).toBe("순서는?");
    expect(numbered.card.items).toEqual(["씻는다", "자른다", "볶는다"]);
    expect(numbered.dropped).toEqual([]);
    expect(errorsOf(numbered.card)).toEqual([]);

    const arrows = changeType({ id: 1, type: "basic", front: "순서는?", back: "요청 → 검증 → 응답" }, "sequence");
    expect(arrows.card.items).toEqual(["요청", "검증", "응답"]);
    expect(errorsOf(arrows.card)).toEqual([]);
  });

  it("basic → sequence: 쪼갤 수 없으면 두 번째 항목을 비우고 알린다", () => {
    const { card, dropped } = changeType({ id: 1, type: "basic", front: "순서는?", back: "한덩어리" }, "sequence");
    expect(card.items).toEqual(["한덩어리", ""]);
    expect(dropped.join(" ")).toContain("쪼갤 수 없어");
  });

  it("cloze → basic: 빈칸은 ____ 로, 답은 뒷면으로 간다", () => {
    const { card, dropped } = changeType(cloze, "basic");
    expect(card.front).toBe("상태는 ____ 로 만들고 ____ 로 동기화한다");
    expect(card.back).toBe("useState / useEffect");
    expect(dropped).toEqual([]);
    expect(errorsOf(card)).toEqual([]);
  });

  it("cloze → sequence: 빈칸을 지운 문장이 질문, 답이 항목이 된다", () => {
    const { card } = changeType(cloze, "sequence");
    expect(card.front).toBe("상태는 로 만들고 로 동기화한다");
    expect(card.items).toEqual(["useState", "useEffect"]);
    expect(errorsOf(card)).toEqual([]);
  });

  it("cloze → sequence: 빈칸이 하나뿐이면 두 번째 항목을 비우고 알린다", () => {
    const one: Card = { id: 1, type: "cloze", text: "상태는 {{useState}} 로 만든다" };
    const { card, dropped } = changeType(one, "sequence");
    expect(card.items).toEqual(["useState", ""]);
    expect(dropped.join(" ")).toContain("빈칸이 1개");
  });

  it("sequence → basic: 항목이 번호 목록 뒷면이 된다", () => {
    const { card, dropped } = changeType(sequence, "basic");
    expect(card.front).toBe("배포 순서는?");
    expect(card.back).toBe("1. 빌드\n2. 검증\n3. 배포");
    expect(dropped).toEqual([]);
    expect(errorsOf(card)).toEqual([]);
  });

  it("sequence → cloze: 항목을 화살표로 잇고 전부 빈칸으로 만든다", () => {
    const { card, dropped } = changeType(sequence, "cloze");
    expect(card.text).toBe("{{빌드}} → {{검증}} → {{배포}}");
    expect(dropped.join(" ")).toContain("앞면");
    expect(errorsOf(card)).toEqual([]);
  });

  it("원본 카드를 변형하지 않는다", () => {
    const before = JSON.stringify(sequence);
    changeType(sequence, "cloze");
    changeType(sequence, "basic");
    expect(JSON.stringify(sequence)).toBe(before);
  });
});
