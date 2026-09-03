/**
 * 덱 상태 + 실행 취소.
 *
 * `deck.ts` 의 조작이 전부 새 객체를 돌려주므로 히스토리는 참조 목록으로 충분하다 —
 * JSON 스냅샷을 뜰 이유가 없다(카드 수백 장짜리 덱을 타이핑마다 직렬화하지 않는다).
 *
 * 과거·현재·미래를 **한 상태**에 담는다. 셋이 따로 놀면 undo 직후 canRedo 가
 * 한 프레임 늦게 켜지는 종류의 어긋남이 생긴다.
 */
import { useCallback, useState } from "react";
import type { Deck } from "../engine/types";

/** 히스토리 상한. 넘으면 가장 오래된 것부터 버린다. */
const LIMIT = 100;

interface Timeline {
  past: Deck[];
  deck: Deck;
  future: Deck[];
  dirty: boolean;
}

export function useDeckStore(initial: Deck) {
  const [t, setT] = useState<Timeline>({ past: [], deck: initial, future: [], dirty: false });

  /** 편집 한 번 = 히스토리 한 칸. 새로 편집하면 되돌린 미래는 버린다. */
  const setDeck = useCallback((next: Deck) => {
    setT((cur) => {
      if (next === cur.deck) return cur;
      const past = cur.past.length >= LIMIT ? cur.past.slice(cur.past.length - LIMIT + 1) : cur.past.slice();
      past.push(cur.deck);
      return { past, deck: next, future: [], dirty: true };
    });
  }, []);

  /** 파일·예제를 열었을 때 — 다른 문서로 갈아탄 것이므로 히스토리를 버린다. */
  const replace = useCallback((next: Deck) => {
    setT({ past: [], deck: next, future: [], dirty: false });
  }, []);

  const undo = useCallback(() => {
    setT((cur) => {
      if (!cur.past.length) return cur;
      const past = cur.past.slice();
      const prev = past.pop() as Deck;
      return { past, deck: prev, future: [cur.deck, ...cur.future], dirty: true };
    });
  }, []);

  const redo = useCallback(() => {
    setT((cur) => {
      if (!cur.future.length) return cur;
      const [next, ...future] = cur.future;
      return { past: [...cur.past, cur.deck], deck: next, future, dirty: true };
    });
  }, []);

  const markSaved = useCallback(() => {
    setT((cur) => (cur.dirty ? { ...cur, dirty: false } : cur));
  }, []);

  return {
    deck: t.deck,
    setDeck,
    replace,
    undo,
    redo,
    canUndo: t.past.length > 0,
    canRedo: t.future.length > 0,
    dirty: t.dirty,
    markSaved,
  };
}
