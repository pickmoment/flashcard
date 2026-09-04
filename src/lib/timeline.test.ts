import { describe, expect, it } from "vitest";
import type { Deck } from "../engine/types";
import { LIMIT, isDirty, markSaved, push, redo, replace, undo } from "./timeline";

const base = (): Deck => ({ id: "flashcards-test-v1", title: "테스트", cards: [] });

/** 참조가 다른 새 덱 — 히스토리는 참조로만 구분하므로 내용은 상관없다. */
const edit = (d: Deck, title: string): Deck => ({ ...d, title });

describe("dirty 는 저장 시점과의 참조 비교다", () => {
  it("처음 연 문서는 깨끗하다", () => {
    expect(isDirty(replace(base()))).toBe(false);
  });

  it("편집하면 dirty, undo 로 저장 상태에 돌아오면 다시 깨끗하다", () => {
    const t0 = replace(base());
    const t1 = push(t0, edit(t0.deck, "가"));
    expect(isDirty(t1)).toBe(true);
    const t2 = undo(t1);
    expect(isDirty(t2)).toBe(false);
    expect(t2.deck).toBe(t0.deck);
  });

  it("undo 뒤 redo 는 다시 dirty 다", () => {
    const t0 = replace(base());
    const t1 = push(t0, edit(t0.deck, "가"));
    expect(isDirty(redo(undo(t1)))).toBe(true);
  });

  it("저장 뒤 undo 는 dirty 다 — 디스크에는 저장한 쪽이 있다", () => {
    const t0 = replace(base());
    const t1 = markSaved(push(t0, edit(t0.deck, "가")));
    expect(isDirty(t1)).toBe(false);
    expect(isDirty(undo(t1))).toBe(true);
    /* 저장 상태로 redo 하면 다시 깨끗하다 */
    expect(isDirty(redo(undo(t1)))).toBe(false);
  });

  it("markSaved 는 히스토리를 건드리지 않고, 이미 깨끗하면 같은 참조를 준다", () => {
    const t0 = replace(base());
    const t1 = push(t0, edit(t0.deck, "가"));
    const t2 = markSaved(t1);
    expect(t2.past).toBe(t1.past);
    expect(t2.past).toHaveLength(1);
    expect(markSaved(t2)).toBe(t2);
  });

  it("dirty 로 갈아탄 문서(자동 복구)는 어떤 덱이든 dirty 다", () => {
    const t0 = replace(base(), { dirty: true });
    expect(isDirty(t0)).toBe(true);
    expect(isDirty(push(t0, edit(t0.deck, "가")))).toBe(true);
    expect(isDirty(markSaved(t0))).toBe(false);
  });
});

describe("push · undo · redo", () => {
  it("같은 참조를 넣으면 아무 일도 없다", () => {
    const t0 = replace(base());
    expect(push(t0, t0.deck)).toBe(t0);
  });

  it("새 편집은 되돌린 미래를 버린다", () => {
    const t0 = replace(base());
    const t1 = push(t0, edit(t0.deck, "가"));
    const t2 = undo(t1);
    expect(t2.future).toHaveLength(1);
    const t3 = push(t2, edit(t2.deck, "나"));
    expect(t3.future).toHaveLength(0);
    expect(t3.past).toHaveLength(1);
  });

  it("끝에서 undo · redo 는 같은 참조를 준다", () => {
    const t0 = replace(base());
    expect(undo(t0)).toBe(t0);
    expect(redo(t0)).toBe(t0);
  });

  it("LIMIT 를 넘으면 가장 오래된 것부터 버린다", () => {
    let t = replace(base());
    const first = t.deck;
    for (let i = 0; i < LIMIT + 5; i++) t = push(t, edit(t.deck, String(i)));
    expect(t.past).toHaveLength(LIMIT);
    expect(t.past.includes(first)).toBe(false);
    /* 남은 것 중 가장 오래된 것은 6번째 편집 결과(0..4 가 버려졌다) */
    expect(t.past[0].title).toBe("4");
    /* 끝까지 되돌리면 거기서 멈춘다 — 버려진 과거로는 못 간다 */
    for (let i = 0; i < LIMIT + 10; i++) t = undo(t);
    expect(t.deck.title).toBe("4");
    expect(t.past).toHaveLength(0);
  });
});
