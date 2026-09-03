/**
 * markdown 필드 — textarea + 삽입 툴바.
 *
 * 툴바에는 `base.html` 의 md() 가 실제로 해석하는 문법만 넣는다. 헤딩·표·링크 버튼을
 * 주면 산출물에 글자 그대로 실려서, 사용자는 원인을 엔진이 아니라 자기 문장에서 찾는다.
 */
import { useState } from "react";
import { useTextInsert } from "./useTextInsert";

/**
 * 툴바 버튼. mousedown 을 막아 포커스를 textarea 에 남긴다 — 그래야 클릭 시점에도
 * 선택 영역이 살아 있고, 감싸기가 사용자가 고른 글을 그대로 집는다.
 */
function Tool({ label, title, onClick }: { label: string; title: string; onClick: () => void }) {
  return (
    <button
      type="button"
      className="btn sm ghost"
      title={title}
      onMouseDown={(e) => e.preventDefault()}
      onClick={onClick}
    >
      {label}
    </button>
  );
}

export function MarkdownField({
  value,
  rows = 3,
  bad,
  onChange,
  onInsertImage,
}: {
  value: string;
  rows?: number;
  bad?: boolean;
  onChange: (value: string) => void;
  /** 이미지를 data URI 로 돌려준다. 없으면 삽입 버튼을 숨긴다 */
  onInsertImage?: () => Promise<string | null>;
}) {
  const { ref, surround, editLines } = useTextInsert(value, onChange);
  const [typing, setTyping] = useState(false);

  const insertImage = async () => {
    if (!onInsertImage) return;
    const uri = await onInsertImage();
    if (!uri) return;
    // 선택한 글이 있으면 그것을 alt 로 쓴다 — 대체 텍스트가 퀴즈 보기에 쓰인다
    surround({ before: "![", after: `](${uri})`, placeholder: "그림" });
  };

  return (
    <>
      <div className="row tight">
        <Tool
          label="굵게"
          title="**굵게** — 뒷면에서 포인트색으로 나온다"
          onClick={() => surround({ before: "**", after: "**", placeholder: "굵게" })}
        />
        <Tool
          label="코드"
          title="`인라인 코드`"
          onClick={() => surround({ before: "`", after: "`", placeholder: "코드" })}
        />
        <Tool
          label="코드블록"
          title="``` 블록 — 퀴즈에서는 이 부분이 답으로 안 쓰인다"
          onClick={() =>
            surround({ before: "```\n", after: "\n```", placeholder: "코드", block: true })
          }
        />
        <Tool
          label="목록"
          title="- 불릿 목록 (선택한 줄 전체)"
          onClick={() => editLines((l) => (/^\s*[-*+]\s/.test(l) ? l : "- " + l))}
        />
        {onInsertImage && (
          <Tool
            label="이미지"
            title="그림을 data URI 로 심는다 — 단일 파일을 깨지 않는다"
            onClick={() => void insertImage()}
          />
        )}
        <Tool
          label="mermaid"
          title="mermaid 다이어그램 — 뒷면에 있을 때만 그림으로 렌더된다"
          onClick={() =>
            surround({
              before: "```mermaid\n",
              after: "\n```",
              placeholder: "flowchart LR\n  A[…] --> B[…]",
              block: true,
            })
          }
        />
      </div>
      <textarea
        ref={ref}
        className={bad ? "textarea bad" : "textarea"}
        rows={rows}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onFocus={() => setTyping(true)}
        onBlur={() => setTyping(false)}
      />
      {/* 카드 하나에 markdown 필드가 셋까지 있어서, 문법 안내를 늘 펼쳐 두면 폼이 안내문에 묻힌다 */}
      {typing && (
        <p className="field-hint">
          {"**굵게** · *기울임* · `코드` · ``` 코드블록 · `- ` 목록 · `---` 구분선 · " +
            "![alt](data:…) 이미지만 된다. 헤딩(#)·표·링크는 렌더되지 않고 글자로 나온다"}
        </p>
      )}
    </>
  );
}
