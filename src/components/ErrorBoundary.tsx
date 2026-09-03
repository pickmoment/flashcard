/**
 * 하위 트리의 렌더 예외를 잡는다.
 *
 * 목적은 하나다 — 흰 화면을 내보내지 않는 것. 웹뷰에는 개발자 콘솔이 늘 열려 있지
 * 않으니 메시지와 스택 앞부분을 화면에 남긴다.
 */
import { Component, type ErrorInfo, type ReactNode } from "react";

interface Props {
  children: ReactNode;
}

interface State {
  error: Error | null;
  stack: string;
}

export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null, stack: "" };

  static getDerivedStateFromError(error: Error): Partial<State> {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error("flashcard crash:", error, info.componentStack);
    /* 스택 전체는 화면을 넘긴다 — 원인이 드러나는 앞 8줄만 남긴다. */
    const stack = (error.stack ?? info.componentStack ?? "").split("\n").slice(0, 8).join("\n");
    this.setState({ stack });
  }

  render() {
    const { error, stack } = this.state;
    if (!error) return this.props.children;
    return (
      <div className="crash">
        <h1>화면을 그리다 멈췄다</h1>
        <p>{error.message || String(error)}</p>
        {stack ? <div className="doc">{stack}</div> : null}
        <p className="hint">
          방금 고친 값이 원인일 수 있다. 새로 고치면 마지막으로 저장한 상태에서 다시 시작한다.
        </p>
        <button type="button" className="btn primary" onClick={() => location.reload()}>
          새로 고침
        </button>
      </div>
    );
  }
}
