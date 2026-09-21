import { useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { isDesktopRuntime } from "../storage/repository";
import { flowSummaryInput } from "../flowSummary";

type Prepared = { workspaceRoot: string; input: ReturnType<typeof flowSummaryInput> };
export function FlowSummary({ prepare }: { prepare: () => Promise<Prepared> }) {
  const running = useRef(false);
  const [status, setStatus] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState<{ path: string; markdown: string }>();
  const summarize = async () => {
    if (running.current) return;
    running.current = true; setBusy(true); setError(""); setResult(undefined);
    setStatus("편집 내용과 파일 저장을 확인하는 중…");
    try {
      const prepared = await prepare();
      setStatus("Flow를 요약하는 중…");
      setResult(await invoke("summarize_flow", prepared));
      setStatus("요약 파일을 저장했습니다.");
    } catch (error) { setError(String(error)); setStatus(""); }
    finally { running.current = false; setBusy(false); }
  };
  return <section className="flow-summary" aria-label="Flow 요약">
    <button className="button" disabled={busy || !isDesktopRuntime()} onClick={() => void summarize()}>이 Flow 요약</button>
    {status && <span role="status" className="flow-summary-status">{status}</span>}
    {error && <p className="flow-summary-error" role="alert">요약 실패: {error}</p>}
    {result && <details className="flow-summary-result">
      <summary>요약 Markdown 보기</summary>
      <p>{result.path}</p>
      <pre>{result.markdown}</pre>
    </details>}
  </section>;
}
