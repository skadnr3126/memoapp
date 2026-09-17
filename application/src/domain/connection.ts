import { BlockId, Flow } from "./flow";
export type ConnectionState =
  | { kind: "idle" }
  | { kind: "first"; flowId: string }
  | { kind: "second"; flowId: string; first: BlockId }
  | { kind: "ready"; flowId: string; first: BlockId; second: BlockId };
export const startConnection = (flow: Flow, selected: BlockId[]): ConnectionState =>
  selected.length === 1 && flow.blockIds.includes(selected[0])
    ? { kind: "second", flowId: flow.id, first: selected[0] }
    : { kind: "first", flowId: flow.id };
export const chooseConnectionBlock = (state: ConnectionState, id: BlockId): ConnectionState => {
  if (state.kind === "idle") return state;
  if (state.kind === "first") return { kind: "second", flowId: state.flowId, first: id };
  return { kind: "ready", flowId: state.flowId, first: state.first, second: id };
};
