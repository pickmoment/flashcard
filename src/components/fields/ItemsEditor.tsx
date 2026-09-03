/**
 * sequence 카드의 항목 편집기.
 *
 * 번호를 크게 보여준다 — 이 순서가 정답이라는 사실이 화면에 없으면 사용자가
 * 아무 순서로 적고, 산출물은 그것을 정답으로 채점한다.
 */
export function ItemsEditor({
  value,
  bad,
  onChange,
}: {
  value: string[];
  bad?: boolean;
  onChange: (value: string[]) => void;
}) {
  const swap = (i: number, delta: number) => {
    const j = i + delta;
    if (j < 0 || j >= value.length) return;
    const next = value.slice();
    next[i] = value[j];
    next[j] = value[i];
    onChange(next);
  };

  return (
    <>
      <p className="field-hint">앞면에서는 섞여 나온다 — 여기 적은 위→아래가 채점 기준이다</p>
      {value.map((item, i) => (
        <div className="row" key={i}>
          <span className="card-row-n">{i + 1}</span>
          <input
            className={bad && !item.trim() ? "input bad" : "input"}
            value={item}
            placeholder={`${i + 1}번째 단계`}
            onChange={(e) => {
              const next = value.slice();
              next[i] = e.target.value;
              onChange(next);
            }}
          />
          <button
            type="button"
            className="btn sm ghost"
            title="위로"
            disabled={i === 0}
            onClick={() => swap(i, -1)}
          >
            ↑
          </button>
          <button
            type="button"
            className="btn sm ghost"
            title="아래로"
            disabled={i === value.length - 1}
            onClick={() => swap(i, 1)}
          >
            ↓
          </button>
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
          + 항목 추가
        </button>
        {value.length < 2 && (
          <span className="diag err">
            <span className="diag-mark">✗</span>
            순서를 물으려면 항목이 2개 이상이어야 한다
          </span>
        )}
        {value.length > 7 && (
          <span className="diag warn">
            <span className="diag-mark">!</span>
            {value.length}개다 — 7개를 넘으면 한 카드로 외우기 어렵다
          </span>
        )}
      </div>
    </>
  );
}
