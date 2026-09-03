/**
 * textarea 삽입 도구.
 *
 * 값은 카드가 들고 있고 폼은 그것을 비추기만 하므로, 삽입도 `onChange` 로 올려 보낸다.
 * 커서는 새 값이 커밋된 뒤에야 되돌릴 수 있어서 effect 로 한 박자 미룬다.
 * MarkdownField 와 ClozeField 가 같은 도구를 쓴다 — 두 곳에 복제하면 커서 되돌리기 버그가
 * 두 번 재발한다.
 */
import { useEffect, useRef } from "react";

interface Surround {
  before: string;
  after?: string;
  /** 선택이 없을 때 대신 넣고 골라 두는 자리 글 */
  placeholder?: string;
  /** 앞뒤 줄바꿈을 보장한다 — 코드블록은 줄 머리에서만 블록으로 잡힌다 */
  block?: boolean;
}

export function useTextInsert(value: string, onChange: (v: string) => void) {
  const ref = useRef<HTMLTextAreaElement | null>(null);
  const pending = useRef<[number, number] | null>(null);

  useEffect(() => {
    const sel = pending.current;
    const el = ref.current;
    if (!sel || !el) return;
    pending.current = null;
    el.focus();
    el.setSelectionRange(sel[0], sel[1]);
  }, [value]);

  /** 선택 영역을 감싼다. 선택이 없으면 placeholder 를 넣고 그 안쪽을 골라 둔다. */
  const surround = (o: Surround) => {
    const el = ref.current;
    if (!el) return;
    const from = el.selectionStart;
    const to = el.selectionEnd;
    const picked = value.slice(from, to) || o.placeholder || "";
    let head = o.before;
    let tail = o.after ?? "";
    if (o.block) {
      if (from > 0 && value[from - 1] !== "\n") head = "\n" + head;
      if (to < value.length && value[to] !== "\n") tail = tail + "\n";
    }
    const at = from + head.length;
    pending.current = [at, at + picked.length];
    onChange(value.slice(0, from) + head + picked + tail + value.slice(to));
  };

  /** 선택이 걸친 줄 전체를 바꾼다 — 목록처럼 줄 머리를 건드리는 도구용. */
  const editLines = (fn: (line: string) => string) => {
    const el = ref.current;
    if (!el) return;
    const from = el.selectionStart === 0 ? 0 : value.lastIndexOf("\n", el.selectionStart - 1) + 1;
    const nl = value.indexOf("\n", el.selectionEnd);
    const to = nl < 0 ? value.length : nl;
    const next = (value.slice(from, to) || "항목")
      .split("\n")
      .map(fn)
      .join("\n");
    pending.current = [from, from + next.length];
    onChange(value.slice(0, from) + next + value.slice(to));
  };

  return { ref, surround, editLines };
}
