/**
 * 덱 상태 + 실행 취소. 로직은 `timeline.ts` 에 있고 여기는 React 상태로 감싼다.
 *
 * 과거·현재·미래·저장 참조를 **한 상태**에 담는다. 넷이 따로 놀면 undo 직후 canRedo 가
 * 한 프레임 늦게 켜지는 종류의 어긋남이 생긴다.
 */
import { useCallback, useMemo, useState } from "react";
import type { Deck } from "../engine/types";
import * as tl from "./timeline";

export function useDeckStore(initial: Deck) {
  const [t, setT] = useState<tl.Timeline>(() => tl.replace(initial));

  const setDeck = useCallback((next: Deck) => setT((cur) => tl.push(cur, next)), []);

  /** 파일·예제를 열었을 때 — 다른 문서로 갈아탄 것이므로 히스토리를 버린다. */
  const replace = useCallback(
    (next: Deck, opts?: { dirty?: boolean }) => setT(tl.replace(next, opts)),
    [],
  );

  const undo = useCallback(() => setT(tl.undo), []);
  const redo = useCallback(() => setT(tl.redo), []);
  const markSaved = useCallback(() => setT(tl.markSaved), []);

  /* 콜백은 전부 안정된 참조라 store 객체도 상태가 바뀔 때만 새로 만든다 —
     의존성에 store 를 적은 useCallback 이 매 렌더마다 갈리지 않는다 */
  return useMemo(
    () => ({
      deck: t.deck,
      setDeck,
      replace,
      undo,
      redo,
      canUndo: t.past.length > 0,
      canRedo: t.future.length > 0,
      dirty: tl.isDirty(t),
      markSaved,
    }),
    [t, setDeck, replace, undo, redo, markSaved],
  );
}
