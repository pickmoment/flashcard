/**
 * cloze 필드 — 문장 안의 `{{정답}}` 이 빈칸이 된다.
 *
 * 빈칸 목록을 입력 아래에 그대로 펼친다. `{{ }}` 짝이 안 맞으면 산출물에서 통째로
 * 사라지는데, 그 사실을 미리보기까지 가서 알면 늦다.
 */
import { FCD } from "../../engine/boot";
import { useTextInsert } from "./useTextInsert";

export function ClozeField({
  value,
  rows = 5,
  bad,
  onChange,
}: {
  value: string;
  rows?: number;
  bad?: boolean;
  onChange: (value: string) => void;
}) {
  const { ref, surround } = useTextInsert(value, onChange);
  const answers = FCD.clozeAnswers(value);

  return (
    <>
      <div className="row tight">
        <button
          type="button"
          className="btn sm ghost"
          title="선택한 글을 {{ }} 로 감싼다. 선택이 없으면 빈 빈칸을 넣는다"
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => surround({ before: "{{", after: "}}" })}
        >
          선택 영역을 빈칸으로
        </button>
      </div>
      <textarea
        ref={ref}
        className={bad ? "textarea bad" : "textarea"}
        rows={rows}
        value={value}
        onChange={(e) => onChange(e.target.value)}
      />
      <div className="row tight">
        {answers.length === 0 ? (
          <span className="badge err">빈칸이 없다 — 외울 곳을 {"{{ }}"} 로 감싼다</span>
        ) : (
          <>
            {answers.length >= 5 && (
              <span className="badge warn">{answers.length}개 — 문장이 암호가 된다</span>
            )}
            {answers.map((a, i) => (
              <span key={i} className={a ? "badge" : "badge err"}>
                {a || "빈 빈칸"}
              </span>
            ))}
          </>
        )}
      </div>
    </>
  );
}
