/**
 * 실행 취소 히스토리 — 순수 함수. React 는 `useDeckStore` 가 감싼다.
 *
 * `deck.ts` 의 조작이 전부 새 객체를 돌려주므로 히스토리는 참조 목록으로 충분하다 —
 * JSON 스냅샷을 뜰 이유가 없다(카드 수백 장짜리 덱을 타이핑마다 직렬화하지 않는다).
 *
 * dirty 는 플래그가 아니라 **참조 비교**다. 마지막으로 디스크와 같았던 덱을 `saved` 에 들고,
 * 현재 덱이 그 참조와 다르면 dirty 다. 플래그로 두면 편집 → undo 로 저장 시점에 정확히
 * 돌아왔는데도 "저장 안 됨" 이라 말하고, 저장 → undo 는 반대로 깨끗하다고 거짓말한다.
 * `saved` 가 null 이면 디스크에 없는 내용이다(자동 복구) — 어떤 덱이든 dirty 다.
 */
import type { Deck } from "../engine/types";

/** 히스토리 상한. 넘으면 가장 오래된 것부터 버린다. */
export const LIMIT = 100;

export interface Timeline {
  past: Deck[];
  deck: Deck;
  future: Deck[];
  saved: Deck | null;
}

/** 다른 문서로 갈아탄다 — 히스토리를 버린다. `dirty` 면 디스크와 다른 내용으로 시작한다. */
export function replace(deck: Deck, opts: { dirty?: boolean } = {}): Timeline {
  return { past: [], deck, future: [], saved: opts.dirty ? null : deck };
}

/** 편집 한 번 = 히스토리 한 칸. 새로 편집하면 되돌린 미래는 버린다. */
export function push(t: Timeline, next: Deck): Timeline {
  if (next === t.deck) return t;
  const past = t.past.length >= LIMIT ? t.past.slice(t.past.length - LIMIT + 1) : t.past.slice();
  past.push(t.deck);
  return { past, deck: next, future: [], saved: t.saved };
}

export function undo(t: Timeline): Timeline {
  if (!t.past.length) return t;
  const past = t.past.slice();
  const prev = past.pop() as Deck;
  return { past, deck: prev, future: [t.deck, ...t.future], saved: t.saved };
}

export function redo(t: Timeline): Timeline {
  if (!t.future.length) return t;
  const [next, ...future] = t.future;
  return { past: [...t.past, t.deck], deck: next, future, saved: t.saved };
}

/** 지금 덱이 디스크에 쓰였다. 히스토리는 그대로 — 저장 뒤에도 되돌릴 수 있어야 한다. */
export function markSaved(t: Timeline): Timeline {
  return t.saved === t.deck ? t : { ...t, saved: t.deck };
}

export function isDirty(t: Timeline): boolean {
  return t.deck !== t.saved;
}
