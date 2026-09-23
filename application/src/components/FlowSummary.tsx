import { useRef, useState, type FormEvent } from "react";
import { invoke } from "@tauri-apps/api/core";
import { isDesktopRuntime } from "../storage/repository";
import { flowSummaryInput } from "../flowSummary";

type Prepared = { workspaceRoot: string; input: ReturnType<typeof flowSummaryInput> };
const keyError = (error: unknown) => String(error).includes("OPENROUTER_KEY_");

export function FlowSummary({ prepare }: { prepare: () => Promise<Prepared> }) {
  const running = useRef(false);
  const [status, setStatus] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [needsKey, setNeedsKey] = useState(false);
  const [open, setOpen] = useState(false);
  const [apiKey, setApiKey] = useState("");
  const [result, setResult] = useState<{ path: string; markdown: string }>();

  const runSummary = async () => {
    setStatus("편집 내용과 파일 저장을 확인하는 중…");
    const prepared = await prepare();
    setStatus("OpenRouter로 Flow를 요약하는 중…");
    setResult(await invoke("summarize_flow", prepared));
    setStatus("요약 파일을 저장했습니다.");
  };
  const summarize = async () => {
    if (running.current) return;
    running.current = true; setBusy(true); setError(""); setResult(undefined);
    try {
      if (!await invoke<boolean>("has_openrouter_api_key")) { setNeedsKey(true); setStatus(""); return; }
      setOpen(false);
      await runSummary();
    } catch (error) {
      if (keyError(error)) setNeedsKey(true);
      setError(String(error).replace(/^OPENROUTER_KEY_(?:REQUIRED|INVALID):/, "")); setStatus("");
    } finally { running.current = false; setBusy(false); }
  };
  const close = () => { setOpen(false); setNeedsKey(false); setApiKey(""); setError(""); };
  const deleteKey = async () => {
    setBusy(true); setError("");
    try {
      await invoke("delete_openrouter_api_key");
      setNeedsKey(true); setStatus("저장된 API 키를 삭제했습니다.");
    } catch (error) { setError(String(error)); }
    finally { setBusy(false); }
  };
  const registerKey = async (event: FormEvent) => {
    event.preventDefault(); setBusy(true); setError(""); setStatus("OpenRouter API 키를 확인하는 중…");
    try {
      await invoke("save_openrouter_api_key", { apiKey });
      setApiKey(""); setNeedsKey(false); setOpen(false);
      await runSummary();
    } catch (error) {
      setError(String(error).replace(/^OPENROUTER_KEY_INVALID:/, "")); setStatus("");
    } finally { setBusy(false); }
  };
  return <section className="flow-summary" aria-label="Flow 요약">
    <button className="button" disabled={busy || !isDesktopRuntime()} onClick={() => { setOpen(true); setError(""); }}>이 Flow 요약</button>
    {status && <span role="status" className="flow-summary-status">{status}</span>}
    {open && <div className="flow-summary-key" role="dialog" aria-label="Flow 요약 확인">
      <button type="button" className="flow-summary-close" aria-label="닫기" disabled={busy} onClick={close}>×</button>
      {!needsKey && <>
        <p>이 Flow를 OpenRouter로 요약할까요?</p>
        <button type="button" className="button button-primary" disabled={busy} onClick={() => void summarize()}>요약하기</button>
        <button type="button" className="button" disabled={busy} onClick={() => void deleteKey()}>저장된 API 키 삭제</button>
      </>}
    {needsKey && <form onSubmit={event => void registerKey(event)}>
      <label htmlFor="openrouter-api-key">OpenRouter API 키</label>
      <input id="openrouter-api-key" type="password" autoComplete="off" value={apiKey} onChange={event => setApiKey(event.target.value)} required autoFocus />
      <button className="button button-primary" disabled={busy}>등록하고 요약</button>
      <small>키는 Windows 자격 증명 관리자에 저장됩니다. 무료 모델 라우터를 사용합니다.</small>
      {error && <span className="flow-summary-key-error" role="alert">등록 실패: {error}</span>}
    </form>}
    {error && !needsKey && <p className="flow-summary-key-error" role="alert">{error}</p>}
    </div>}
    {error && !open && <p className="flow-summary-error" role="alert">요약 실패: {error}</p>}
    {result && <details className="flow-summary-result">
      <summary>요약 Markdown 보기</summary>
      <p>{result.path}</p>
      <pre>{result.markdown}</pre>
    </details>}
  </section>;
}
