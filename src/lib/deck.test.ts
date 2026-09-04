import { describe, expect, it } from "vitest";
import type { Deck } from "../engine/types";
import {
  addCard,
  categoriesOf,
  duplicateCard,
  emptyDeck,
  moveCard,
  moveCardTo,
  patchDeck,
  removeCard,
  removeCards,
  renameCategory,
  renumberCards,
  setCategory,
  withCard,
} from "./deck";

const three = (): Deck => ({
  id: "flashcards-test-v1",
  title: "테스트",
  cards: [
    { id: 1, type: "basic", category: "가", front: "질문1", back: "답1" },
    { id: 2, type: "basic", category: "나", front: "질문2", back: "답2" },
    { id: 3, type: "cloze", category: "가", text: "{{답3}} 이다" },
  ],
});

/** 입력 불변 검사 — 조작 전후로 원본 JSON 이 같아야 한다. */
function frozen(deck: Deck, fn: (d: Deck) => unknown) {
  const before = JSON.stringify(deck);
  fn(deck);
  expect(JSON.stringify(deck)).toBe(before);
}

describe("emptyDeck", () => {
  it("바로 편집할 수 있는 basic 카드 한 장으로 시작한다", () => {
    const d = emptyDeck();
    expect(d.cards).toHaveLength(1);
    expect(d.cards[0]).toMatchObject({ id: 1, type: "basic" });
    expect(d.quiz).toBe("auto");
    expect(d.ratio).toBe("8/5");
  });
});

describe("withCard", () => {
  it("같은 id 카드만 교체한다", () => {
    const d = three();
    const next = withCard(d, { id: 2, type: "basic", front: "바뀜", back: "답2" });
    expect(next.cards[1].front).toBe("바뀜");
    expect(next.cards[0]).toBe(d.cards[0]);
  });

  it("없는 id 면 그대로 돌려준다", () => {
    const d = three();
    expect(withCard(d, { id: 99, type: "basic", front: "x", back: "y" })).toBe(d);
  });

  it("입력을 변형하지 않는다", () => {
    frozen(three(), (d) => withCard(d, { id: 1, type: "basic", front: "새", back: "새" }));
  });
});

describe("addCard", () => {
  it("afterId 바로 뒤에 끼운다", () => {
    const { deck, id } = addCard(three(), "cloze", 1);
    expect(deck.cards.map((c) => c.id)).toEqual([1, 4, 2, 3]);
    expect(id).toBe(4);
    expect(deck.cards[1].type).toBe("cloze");
  });

  it("afterId 가 없으면 맨 뒤에 붙인다", () => {
    const { deck } = addCard(three(), "sequence");
    expect(deck.cards.map((c) => c.id)).toEqual([1, 2, 3, 4]);
  });

  it("지운 카드의 id 를 재사용하지 않는다 — 학습 기록이 딸려 온다", () => {
    const gap = removeCard(three(), 2);
    const { id } = addCard(gap, "basic");
    expect(id).toBe(4);
    expect(gap.cards.map((c) => c.id)).toEqual([1, 3]);
  });

  it("입력을 변형하지 않는다", () => {
    frozen(three(), (d) => addCard(d, "basic", 2));
  });
});

describe("removeCard", () => {
  it("없는 id 면 참조 그대로다", () => {
    const d = three();
    expect(removeCard(d, 99)).toBe(d);
  });

  it("해당 카드만 뺀다", () => {
    expect(removeCard(three(), 1).cards.map((c) => c.id)).toEqual([2, 3]);
  });
});

describe("duplicateCard", () => {
  it("원본 바로 뒤에 새 id 로 놓고 갈래·맥락을 잇는다", () => {
    const d: Deck = {
      ...three(),
      cards: [{ id: 1, type: "basic", category: "가", context: "지금까지: 도입", front: "q", back: "a" }],
    };
    const { deck, id } = duplicateCard(d, 1);
    expect(id).toBe(2);
    expect(deck.cards.map((c) => c.id)).toEqual([1, 2]);
    expect(deck.cards[1]).toMatchObject({ category: "가", context: "지금까지: 도입", front: "q", back: "a" });
  });

  it("없는 id 면 덱을 그대로 돌려준다", () => {
    const d = three();
    expect(duplicateCard(d, 99).deck).toBe(d);
  });
});

describe("moveCard", () => {
  it("맨 위에서 -1 은 그대로다", () => {
    const d = three();
    expect(moveCard(d, 1, -1)).toBe(d);
  });

  it("맨 아래에서 +1 은 그대로다", () => {
    const d = three();
    expect(moveCard(d, 3, 1)).toBe(d);
  });

  it("한 칸씩 옮긴다", () => {
    expect(moveCard(three(), 1, 1).cards.map((c) => c.id)).toEqual([2, 1, 3]);
    expect(moveCard(three(), 3, -1).cards.map((c) => c.id)).toEqual([1, 3, 2]);
  });

  it("입력을 변형하지 않는다", () => {
    frozen(three(), (d) => moveCard(d, 2, 1));
  });
});

describe("moveCardTo", () => {
  it("덱 인덱스로 옮긴다", () => {
    expect(moveCardTo(three(), 1, 2).cards.map((c) => c.id)).toEqual([2, 3, 1]);
    expect(moveCardTo(three(), 3, 0).cards.map((c) => c.id)).toEqual([3, 1, 2]);
  });

  it("범위 밖은 끝으로 붙인다", () => {
    expect(moveCardTo(three(), 1, 99).cards.map((c) => c.id)).toEqual([2, 3, 1]);
    expect(moveCardTo(three(), 3, -5).cards.map((c) => c.id)).toEqual([3, 1, 2]);
  });

  it("같은 자리·없는 id 는 참조 그대로", () => {
    const d = three();
    expect(moveCardTo(d, 2, 1)).toBe(d);
    expect(moveCardTo(d, 99, 0)).toBe(d);
  });

  it("입력을 변형하지 않는다", () => {
    frozen(three(), (d) => moveCardTo(d, 1, 2));
  });
});

describe("removeCards", () => {
  it("여러 장을 한 번에 지운다", () => {
    const next = removeCards(three(), [1, 3]);
    expect(next.cards.map((c) => c.id)).toEqual([2]);
  });

  it("없는 id 는 무시하고 남은 카드 참조는 잇는다", () => {
    const d = three();
    const next = removeCards(d, [99, 2]);
    expect(next.cards.map((c) => c.id)).toEqual([1, 3]);
    expect(next.cards[0]).toBe(d.cards[0]);
  });

  it("아무것도 안 지웠으면 참조 그대로", () => {
    const d = three();
    expect(removeCards(d, [])).toBe(d);
    expect(removeCards(d, [7, 8])).toBe(d);
  });

  it("입력을 변형하지 않는다", () => {
    frozen(three(), (d) => removeCards(d, [1, 2]));
  });
});

describe("setCategory", () => {
  it("고른 카드만 바꾸고 나머지 참조는 잇는다", () => {
    const d = three();
    const next = setCategory(d, [1, 3], " 다 ");
    expect(next.cards.map((c) => c.category)).toEqual(["다", "나", "다"]);
    expect(next.cards[1]).toBe(d.cards[1]);
  });

  it("빈 값이면 키째 지운다", () => {
    const next = setCategory(three(), [2], "");
    expect("category" in next.cards[1]).toBe(false);
    expect(next.cards[1]).toMatchObject({ id: 2, front: "질문2" });
  });

  it("이미 같은 값이면 참조 그대로", () => {
    const d = three();
    expect(setCategory(d, [1, 3], "가")).toBe(d);
    expect(setCategory(d, [99], "새")).toBe(d);
  });

  it("입력을 변형하지 않는다", () => {
    frozen(three(), (d) => setCategory(d, [1, 2, 3], "x"));
  });
});

describe("renameCategory", () => {
  it("그 이름인 카드 전부를 바꾼다", () => {
    const d = three();
    const next = renameCategory(d, "가", "다");
    expect(next.cards.map((c) => c.category)).toEqual(["다", "나", "다"]);
    expect(next.cards[1]).toBe(d.cards[1]);
  });

  it("빈 이름으로 바꾸면 카테고리를 뗀다", () => {
    const next = renameCategory(three(), "나", "  ");
    expect("category" in next.cards[1]).toBe(false);
    expect(categoriesOf(next)).toEqual(["가"]);
  });

  it("같은 이름·없는 이름은 참조 그대로", () => {
    const d = three();
    expect(renameCategory(d, "가", "가")).toBe(d);
    expect(renameCategory(d, "없음", "새")).toBe(d);
  });

  it("입력을 변형하지 않는다", () => {
    frozen(three(), (d) => renameCategory(d, "가", "라"));
  });
});

describe("patchDeck", () => {
  it("주어진 키만 바꾼다", () => {
    const d = three();
    const next = patchDeck(d, { title: "새 제목", quiz: "typing" });
    expect(next.title).toBe("새 제목");
    expect(next.quiz).toBe("typing");
    expect(next.cards).toBe(d.cards);
  });

  it("빈 부제는 키째 지운다", () => {
    const next = patchDeck({ ...three(), subtitle: "부제" }, { subtitle: "" });
    expect("subtitle" in next).toBe(false);
  });
});

describe("categoriesOf", () => {
  it("등장 순서를 지키고 빈 값·중복을 뺀다", () => {
    const d: Deck = {
      ...three(),
      cards: [
        { id: 1, type: "basic", category: "나" },
        { id: 2, type: "basic" },
        { id: 3, type: "basic", category: "가" },
        { id: 4, type: "basic", category: "나" },
        { id: 5, type: "basic", category: "  " },
      ],
    };
    expect(categoriesOf(d)).toEqual(["나", "가"]);
  });
});

describe("renumberCards", () => {
  it("id 를 1..n 으로 다시 매긴다", () => {
    const d = removeCard(three(), 2);
    expect(renumberCards(d).cards.map((c) => c.id)).toEqual([1, 2]);
  });

  it("입력을 변형하지 않는다", () => {
    frozen(three(), (d) => renumberCards(d));
  });
});
