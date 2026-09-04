/**
 * 스펙 원문 편집.
 *
 * 폼이 못 다루는 필드를 고칠 때, 그리고 남이 준 덱을 통째로 붙여넣을 때 쓴다.
 * 타이핑하는 도중에는 절대 반영하지 않는다 — 중간 상태는 대개 깨진 JSON 이고,
 * 유효한 순간마다 덱을 갈아치우면 카드 선택과 미리보기가 매 글자마다 튄다.
 * "적용" 을 누른 순간에만 덱이 바뀐다. 적용은 다른 문서로 갈아타는 것이 아니라 같은 문서의
 * 편집이다 — 히스토리에 쌓여 실행 취소로 되돌릴 수 있고, 저장 전까지 dirty 다.
 */
import { useEffect, useMemo, useState } from "react";
import CodeMirror from "@uiw/react-codemirror";
import { json } from "@codemirror/lang-json";
import { oneDark } from "@codemirror/theme-one-dark";
import type { Deck } from "../engine/types";

export function JsonEditor(props: { deck: Deck; onApply(deck: Deck): void }) {
  const source = useMemo(() => JSON.stringify(props.deck, null, 2), [props.deck]);
  const [text, setText] = useState(source);
  const [editing, setEditing] = useState(false);

  /* 폼 쪽 편집이 들어오면 원문을 다시 맞춘다 — 단, 타이핑 중이면 덮어쓰지 않는다. */
  useEffect(() => {
    if (!editing) setText(source);
  }, [editing, source]);

  const parsed = useMemo<{ deck: Deck | null; err: string }>(() => {
    try {
      const value: unknown = JSON.parse(text);
      if (!value || typeof value !== "object" || Array.isArray(value))
        return { deck: null, err: "덱은 객체 하나여야 한다" };
      if (!("cards" in value) || !Array.isArray(value.cards))
        return { deck: null, err: "cards 배열이 있어야 한다" };
      /* 나머지 필드는 엔진이 normalize 에서 기본값으로 메운다 — 여기서 두 번 검사하지 않는다. */
      const deck = value as Deck;
      return { deck, err: "" };
    } catch (e) {
      return { deck: null, err: (e as Error).message };
    }
  }, [text]);

  return (
    <div className="panel grow">
      <div className="panel-head">
        스펙 원문
        <span className="spacer" />
        <button
          type="button"
          className="btn sm ghost"
          disabled={!editing}
          onClick={() => {
            setText(source);
            setEditing(false);
          }}
        >
          되돌리기
        </button>
        <button
          type="button"
          className="btn sm primary"
          disabled={!editing || !parsed.deck}
          onClick={() => {
            if (!parsed.deck) return;
            props.onApply(parsed.deck);
            setEditing(false);
          }}
        >
          적용
        </button>
      </div>
      {editing ? (
        parsed.err ? (
          <div className="diag err">
            <span className="diag-mark">✕</span>
            <span>{parsed.err}</span>
          </div>
        ) : (
          <div className="diag ok">
            <span className="diag-mark">✓</span>
            <span>
              JSON 이 유효하다 — <span className="kbd">적용</span> 을 누르면 덱을 갈아끼운다 (실행 취소로 되돌릴 수 있다)
            </span>
          </div>
        )
      ) : null}
      <div className="scroll grow">
        <CodeMirror
          value={text}
          theme={oneDark}
          extensions={[json()]}
          basicSetup={{ lineNumbers: true, foldGutter: true, highlightActiveLine: true }}
          onChange={(v) => {
            setText(v);
            setEditing(true);
          }}
        />
      </div>
    </div>
  );
}
