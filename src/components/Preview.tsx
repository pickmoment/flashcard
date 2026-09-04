/**
 * 미리보기. `build(deck, { preview: true })` 로 만든 **산출물 그 자체**를 iframe 에 띄운다.
 * 미리보기용 렌더러를 따로 두면 미리보기와 내보낸 파일이 어긋나므로, 보이는 것이 곧 결과다.
 * 조작은 산출물에 실린 훅(`window.FCP`)만 부른다 — 로직 복제가 없으니 둘이 갈라질 수 없다.
 *
 * 문서를 갱신하는 길은 둘이다:
 * - **재빌드**(`html` 이 바뀜 → srcdoc 교체 → 문서 재로드): 엔진이 base.html 에 갈아끼우는
 *   자리 — CONFIG(제목·퀴즈 모드·스토리·양방향·자동재생)·포인트색·비율·mermaid CDN 유무 —
 *   가 바뀌었을 때. 이건 문서 골격의 일부라 제자리에서 바꿀 수 없다. App 이 `configKey` 로 판정한다.
 * - **update**(`cards` 가 바뀜 → `FCP.update(cards)`): 카드 내용·순서·추가·삭제. DECK 만
 *   갈아끼우고 현재 카드를 다시 그리므로 학습 진행·스크롤·탭이 그대로다. 훅에 `update` 가
 *   없는 옛 산출물이면 `onStale` 로 재빌드를 청한다.
 * 카드는 DECK 에 실리는 모양(normalize · orderKeys 를 지난 것)으로 받는다 — 재빌드했을 때와
 * 같은 데이터가 들어가야 두 길의 결과가 같다.
 */
import { useEffect, useRef, useState } from "react";
import type { Card, PreviewHook } from "../engine/types";

export function Preview({
  html,
  cards,
  exportHtml,
  selectedId,
  onError,
  onStale,
}: {
  /** 미리보기 빌드. 바뀌면 문서를 다시 로드한다 */
  html: string;
  /** DECK 모양의 카드. 바뀌면 문서를 재로드하지 않고 `FCP.update` 로 갈아끼운다 */
  cards: Card[];
  /** "새 창" 에 띄울 최신 산출물 — `html` 은 카드 편집을 따라오지 않으므로 따로 받는다 */
  exportHtml: string;
  selectedId: number | null;
  onError: (msg: string) => void;
  /** 훅이 `update` 를 모를 때 — 문서를 다시 빌드해 달라는 신호 */
  onStale: () => void;
}) {
  const frame = useRef<HTMLIFrameElement>(null);
  const [flipped, setFlipped] = useState(false);
  const [view, setView] = useState<"study" | "quiz">("study");
  const [present, setPresent] = useState(false);

  /* onLoad 시점에 짚어 줄 카드와 실어 줄 카드. 상태로 두면 로드 핸들러가 옛 값을 잡는다. */
  const want = useRef(selectedId);
  want.current = selectedId;
  const latest = useRef(cards);
  latest.current = cards;

  const fcp = () => {
    const win = frame.current?.contentWindow as unknown as { FCP?: PreviewHook } | null;
    return win?.FCP;
  };

  /**
   * 카드 편집 → 제자리 갱신. 아직 로드 전이면 훅이 없고, 그때는 onLoad 가 최신 카드를 싣는다.
   * 갱신 뒤 선택 카드를 다시 짚는다 — 새로 추가한 카드는 update 전에는 문서에 없어
   * selectedId 효과의 goto 가 실패했기 때문이다.
   */
  useEffect(() => {
    const hook = fcp();
    if (!hook) return;
    if (!hook.update) return onStale();
    hook.update(cards);
    if (want.current != null) hook.goto(want.current);
  }, [cards, onStale]);

  /* 카드를 갈아탈 때마다 미리보기도 그 카드로 옮긴다 — 편집 중인 카드가 화면에 없으면
     미리보기를 볼 이유가 없다. 아직 로드 전이면 훅이 없고, 그때는 onLoad 가 짚는다. */
  useEffect(() => {
    if (selectedId != null) fcp()?.goto(selectedId);
  }, [selectedId, html]);

  /* 훅이 실제로 전환해 준 뒤에만 버튼 상태를 옮긴다 — 먹지 않은 전환을 켜진 것처럼
     보여 주면 어느 탭을 보고 있는지 화면과 버튼이 어긋난다 */
  const toView = (v: "study" | "quiz") => {
    if (fcp()?.view(v) === v) setView(v);
  };

  const loaded = () => {
    const win = frame.current?.contentWindow;
    const hook = fcp();

    /* 새 문서는 앞면·학습 탭·발표 꺼짐에서 시작한다 — 버튼 상태를 문서에 맞춘다 */
    setFlipped(false);
    setView("study");
    setPresent(false);

    if (!hook) {
      /* 산출물의 런타임은 인라인 <script> 다. load 는 왔는데 FCP 가 없으면
         `preview: false` 로 빌드했거나 그 스크립트가 파싱 단계에서 죽은 것이다 —
         어느 쪽이든 조작 버튼이 전부 먹지 않으므로 조용히 지나가면 안 된다. */
      onError("미리보기 훅(window.FCP)을 찾지 못했다 — preview 빌드가 아니거나 산출물 스크립트가 죽었다");
      return;
    }

    /* 로드 뒤에 나는 오류(카드 렌더·퀴즈 채점 등)를 삼키지 않고 그대로 올린다.
       unhandledrejection 은 걸지 않는다 — iframe 에서 막히는 풀스크린 요청이
       매번 거절로 올라와 진짜 오류를 덮는다. */
    if (win) {
      win.onerror = (msg) => {
        onError(`미리보기 오류: ${typeof msg === "string" ? msg : "스크립트 예외"}`);
        return false;
      };
    }

    /* 문서는 `html` 을 빌드한 시점의 카드로 로드된다 — 그 뒤 편집된 카드를 먼저 싣고 짚는다 */
    hook.update?.(latest.current);
    if (want.current != null) hook.goto(want.current);
  };

  /* 새 창은 우리가 들여다볼 필요가 없는 최상위 문서라 blob URL 로 띄운다(srcdoc 을 쓰는 이유는
     아래 iframe 주석). 창이 문서를 받은 뒤에는 URL 이 필요 없다. */
  const openWindow = () => {
    const url = URL.createObjectURL(new Blob([exportHtml], { type: "text/html" }));
    window.open(url, "_blank");
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
  };

  return (
    <div className="panel grow">
      <div className="panel-head">
        <span>미리보기</span>
        <button
          type="button"
          className={`btn sm${flipped ? " on" : ""}`}
          disabled={!html}
          title="앞면 ↔ 뒷면 (산출물에서는 Space)"
          onClick={() => setFlipped(fcp()?.flip() ?? false)}
        >
          뒤집기
        </button>
        <button
          type="button"
          className={`btn sm${view === "study" ? " on" : ""}`}
          disabled={!html}
          onClick={() => toView("study")}
        >
          카드 학습
        </button>
        <button
          type="button"
          className={`btn sm${view === "quiz" ? " on" : ""}`}
          disabled={!html}
          title="퀴즈 모드가 off 면 산출물에 퀴즈 탭이 없다"
          onClick={() => toView("quiz")}
        >
          퀴즈
        </button>
        <span className="sep" />
        <button
          type="button"
          className={`btn sm${present ? " on" : ""}`}
          disabled={!html}
          onClick={() => setPresent(fcp()?.present(!present) ?? false)}
        >
          발표 모드
        </button>
        <button
          type="button"
          className="btn sm"
          disabled={!html || !present}
          title="발표 중 다음 단계 (산출물에서는 Space)"
          onClick={() => fcp()?.reveal()}
        >
          다음 단계
        </button>
        <span className="spacer" />
        <button
          type="button"
          className="btn sm ghost"
          disabled={!html}
          title="저장된 ✓/✗ 와 마지막 위치를 지우고 처음부터"
          onClick={() => {
            const hook = fcp();
            hook?.reset();
            /* reset 은 첫 카드로 되돌린다 — 편집 중인 카드로 다시 짚어 준다.
               초기화의 결과는 위치가 아니라 지워진 ✓/✗ 다. */
            if (hook && selectedId != null) hook.goto(selectedId);
            setFlipped(false);
            setPresent(false);
          }}
        >
          진행 초기화
        </button>
        <button
          type="button"
          className="btn sm ghost"
          disabled={!exportHtml}
          title="풀스크린 발표·키보드 조작을 그대로 쓰려면 새 창에서 본다"
          onClick={openWindow}
        >
          새 창
        </button>
      </div>

      <div className="preview-wrap">
        {html ? (
          <iframe
            /* srcdoc 으로 띄운다. blob URL 로 내비게이션한 프레임은 요즘 Chromium 이 불투명 출처를
               주어 `contentWindow.FCP` 를 읽는 순간 SecurityError 가 난다(실측: contentDocument 가
               null). srcdoc 문서는 부모 출처를 물려받아 훅도 읽히고 산출물의 localStorage 진행
               저장도 실제로 돈다 — sandbox 를 걸지 않는 한. 걸면 문서가 다시 불투명해져 둘을 함께
               잃는다. allow 로 풀스크린을 열어 주면 발표 모드가 미리보기에서도 실제로 풀스크린으로
               뜨고, 막혔을 때 나던 요청 거절도 사라진다 */
            ref={frame}
            className="preview-frame"
            title="덱 미리보기"
            allow="fullscreen"
            srcDoc={html}
            onLoad={loaded}
          />
        ) : (
          <div className="list-empty">카드를 넣고 오류를 고치면 여기에 산출물이 나온다.</div>
        )}
      </div>

      <div className="preview-note">
        <span className="kbd">Space</span> 뒤집기 · <span className="kbd">←</span>
        <span className="kbd">→</span> 이동 · <span className="kbd">1</span>
        <span className="kbd">2</span> 알아요/몰라요 · <span className="kbd">S</span> 셔플 ·{" "}
        <span className="kbd">P</span> 발표 — 키는 미리보기를 한 번 클릭한 뒤 듣는다. 발표 모드는
        이 칸을 풀스크린으로 덮는다(<span className="kbd">Esc</span> 로 나온다). 진행
        상태(✓/✗ · 마지막 위치)는 브라우저에 저장되므로 다시 빌드해도 남는다.
      </div>
    </div>
  );
}
