/**
 * basic 카드의 객관식 오답 편집기.
 *
 * 순서가 의미 없으므로 번호를 붙이지 않는다(산출물이 보기를 섞는다). 비어 있는 것이
 * 정상 상태라는 사실을 적어 둔다 — 안 그러면 카드마다 오답을 손으로 채우게 된다.
 */
export function ChoicesEditor({
  value,
  onChange,
}: {
  value: string[];
  onChange: (value: string[]) => void;
}) {
  return (
    <>
      {value.map((choice, i) => (
        <div className="row" key={i}>
          <input
            className="input"
            value={choice}
            placeholder="그럴듯한 오답"
            onChange={(e) => {
              const next = value.slice();
              next[i] = e.target.value;
              onChange(next);
            }}
          />
          <button
            type="button"
            className="btn sm ghost"
            title="삭제"
            onClick={() => onChange(value.filter((_, k) => k !== i))}
          >
            ✕
          </button>
        </div>
      ))}
      <div className="row tight">
        <button type="button" className="btn sm" onClick={() => onChange([...value, ""])}>
          + 오답 추가
        </button>
        {value.length === 1 && (
          <span className="diag warn">
            <span className="diag-mark">!</span>
            오답이 1개다 — 객관식은 2개 이상이 필요해서 이 카드만 주관식으로 폴백된다
          </span>
        )}
      </div>
      {value.length === 0 && (
        <p className="field-hint">
          비어 있는 것이 정상이다 — 덱의 다른 카드 답이 오답 후보로 뽑힌다
        </p>
      )}
    </>
  );
}
