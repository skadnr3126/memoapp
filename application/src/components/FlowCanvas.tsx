import { CSSProperties, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { BlockId, Branch, BranchId, Flow, getDisplayTitle, WorkspaceState } from "../domain/flow";

type FlowLane = { branch: Branch; depth: number; startColumn: number };
export type NodePosition = { x: number; y: number };
type PointerDrag = {
  blockIds: BlockId[];
  startX: number;
  startY: number;
  currentX: number;
  currentY: number;
  scrollLeft: number;
  scrollTop: number;
  positions: Record<BlockId, NodePosition>;
  moved: boolean;
};
type PanDrag = { startX: number; startY: number; scrollLeft: number; scrollTop: number };
type SelectionDrag = { startX: number; startY: number; currentX: number; currentY: number };
type Bounds = { left: number; top: number; right: number; bottom: number };
type Connection = { from: BlockId; to: BlockId };
type ConnectionPath = Connection & { d: string };

export const getPannedScroll = (drag: PanDrag, pointerX: number, pointerY: number) => ({
  left: drag.scrollLeft - (pointerX - drag.startX),
  top: drag.scrollTop - (pointerY - drag.startY),
});

export const boundsOverlap = (first: Bounds, second: Bounds) =>
  first.left <= second.right && first.right >= second.left && first.top <= second.bottom && first.bottom >= second.top;

export const getAutoScrollDelta = (pointer: number, start: number, end: number, edge = 48) => {
  if (pointer < start + edge) return -Math.min(18, Math.max(4, start + edge - pointer));
  if (pointer > end - edge) return Math.min(18, Math.max(4, pointer - (end - edge)));
  return 0;
};

export const clampScroll = (position: number, maximum: number) => Math.max(0, Math.min(maximum, position));

type FlowCanvasProps = {
  workspace: WorkspaceState;
  flow: Flow;
  onOpenBlock: (blockId: BlockId) => void;
  onRenameBlock: (blockId: BlockId, title: string) => void;
  nodePositions: Record<BlockId, NodePosition | undefined>;
  selectedBlockIds: BlockId[];
  onSelectedBlockIdsChange: (blockIds: BlockId[]) => void;
  onNodePositionsChange: (positions: Record<BlockId, NodePosition>) => void;
  onAddAfter: (blockId?: BlockId) => void;
  onCreateBranch: (blockId: BlockId) => void;
};

const getFlowLanes = (flow: Flow): FlowLane[] => {
  const lanes: FlowLane[] = [];
  const visit = (branchId: BranchId, depth: number, startColumn: number) => {
    const branch = flow.branches.get(branchId);
    if (!branch) return;
    lanes.push({ branch, depth, startColumn });
    branch.itemIds.forEach((blockId, index) => {
      const nextColumn = startColumn + index;
      (branch.childBranchIdsByBlockId.get(blockId) ?? []).forEach((childBranchId) =>
        visit(childBranchId, depth + 1, nextColumn),
      );
    });
  };
  visit(flow.rootBranchId, 0, 1);
  return lanes;
};

export function FlowCanvas({
  workspace,
  flow,
  onOpenBlock,
  onRenameBlock,
  nodePositions,
  selectedBlockIds,
  onSelectedBlockIdsChange,
  onNodePositionsChange,
  onAddAfter,
  onCreateBranch,
}: FlowCanvasProps) {
  const viewportRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLDivElement>(null);
  const nodeElementsRef = useRef(new Map<BlockId, HTMLElement>());
  const lanes = useMemo(() => getFlowLanes(flow), [flow]);
  const widestColumn = Math.max(2, ...lanes.map((lane) => lane.startColumn + Math.max(lane.branch.itemIds.length, 1)));
  const [scale, setScale] = useState(1);
  const [connectionPaths, setConnectionPaths] = useState<ConnectionPath[]>([]);
  const [canvasSize, setCanvasSize] = useState({ width: 1, height: 1 });
  const pointerDragRef = useRef<PointerDrag | undefined>(undefined);
  const panDragRef = useRef<PanDrag | undefined>(undefined);
  const selectionDragRef = useRef<SelectionDrag | undefined>(undefined);
  const autoScrollPointerRef = useRef<NodePosition | undefined>(undefined);
  const autoScrollFrameRef = useRef<number | undefined>(undefined);
  const autoScrollLimitRef = useRef<NodePosition | undefined>(undefined);
  const suppressClickRef = useRef(false);
  const [selectionDrag, setSelectionDrag] = useState<SelectionDrag>();
  const selectedBlockIdSet = useMemo(() => new Set(selectedBlockIds), [selectedBlockIds]);
  const connections = useMemo(() => {
    const result: Connection[] = [];
    for (const branch of flow.branches.values()) {
      branch.itemIds.slice(1).forEach((blockId, index) => result.push({ from: branch.itemIds[index], to: blockId }));
      branch.itemIds.forEach((blockId) => {
        (branch.childBranchIdsByBlockId.get(blockId) ?? []).forEach((childBranchId) => {
          const childBlockId = flow.branches.get(childBranchId)?.itemIds[0];
          if (childBlockId) result.push({ from: blockId, to: childBlockId });
        });
      });
    }
    return result;
  }, [flow]);
  const canvasStyle = {
    "--canvas-columns": widestColumn,
    "--node-width": `${214 * scale}px`,
    "--node-gap": `${48 * scale}px`,
    "--node-height": `${94 * scale}px`,
    "--node-padding": `${14 * scale}px`,
    "--node-title-size": `${0.92 * scale}rem`,
    "--node-body-size": `${0.74 * scale}rem`,
    "--node-meta-size": `${0.63 * scale}rem`,
    "--node-order-size": `${19 * scale}px`,
    "--node-order-font-size": `${0.64 * scale}rem`,
    "--node-action-size": `${26 * scale}px`,
    "--node-action-font-size": `${1 * scale}rem`,
  } as CSSProperties;

  useEffect(() => {
    const viewport = viewportRef.current;
    if (!viewport) return;
    const fitToViewport = () => {
      const naturalWidth = widestColumn * (214 + 48) + 36;
      const nextScale = Math.max(0.72, Math.min(1, viewport.clientWidth / naturalWidth));
      setScale((current) => (Math.abs(current - nextScale) < 0.01 ? current : nextScale));
    };
    fitToViewport();
    const observer = new ResizeObserver(fitToViewport);
    observer.observe(viewport);
    return () => observer.disconnect();
  }, [widestColumn]);

  useLayoutEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const measureConnections = () => {
      const canvasBounds = canvas.getBoundingClientRect();
      setCanvasSize({ width: canvasBounds.width || 1, height: canvasBounds.height || 1 });
      setConnectionPaths(connections.flatMap(({ from, to }) => {
        const fromElement = nodeElementsRef.current.get(from);
        const toElement = nodeElementsRef.current.get(to);
        if (!fromElement || !toElement) return [];
        const fromBounds = fromElement.getBoundingClientRect();
        const toBounds = toElement.getBoundingClientRect();
        const startX = fromBounds.right - canvasBounds.left;
        const startY = fromBounds.top + fromBounds.height / 2 - canvasBounds.top;
        const endX = toBounds.left - canvasBounds.left;
        const endY = toBounds.top + toBounds.height / 2 - canvasBounds.top;
        const curve = Math.max(36, Math.abs(endX - startX) * 0.45);
        return [{ from, to, d: `M ${startX} ${startY} C ${startX + curve} ${startY}, ${endX - curve} ${endY}, ${endX} ${endY}` }];
      }));
    };
    measureConnections();
    const observer = new ResizeObserver(measureConnections);
    observer.observe(canvas);
    return () => observer.disconnect();
  }, [connections, nodePositions, scale]);

  const finishPanning = (viewport: HTMLDivElement, pointerId: number) => {
    if (!panDragRef.current) return;
    if (viewport.hasPointerCapture(pointerId)) viewport.releasePointerCapture(pointerId);
    panDragRef.current = undefined;
    viewport.classList.remove("is-panning");
  };

  const updateDraggedBlocks = (drag: PointerDrag) => {
    const viewport = viewportRef.current;
    if (!viewport) return;
    const x = drag.currentX - drag.startX + viewport.scrollLeft - drag.scrollLeft;
    const y = drag.currentY - drag.startY + viewport.scrollTop - drag.scrollTop;
    if (Math.abs(x) > 3 || Math.abs(y) > 3) drag.moved = true;
    onNodePositionsChange(Object.fromEntries(drag.blockIds.map((id) => [id, { x: drag.positions[id].x + x, y: drag.positions[id].y + y }])));
  };

  const updateSelectionDrag = (clientX: number, clientY: number) => {
    const drag = selectionDragRef.current;
    const canvas = canvasRef.current;
    if (!drag || !canvas) return;
    const bounds = canvas.getBoundingClientRect();
    const next = { ...drag, currentX: clientX - bounds.left, currentY: clientY - bounds.top };
    selectionDragRef.current = next;
    setSelectionDrag(next);
  };

  const stopAutoScroll = () => {
    autoScrollPointerRef.current = undefined;
    autoScrollLimitRef.current = undefined;
    if (autoScrollFrameRef.current !== undefined) window.cancelAnimationFrame(autoScrollFrameRef.current);
    autoScrollFrameRef.current = undefined;
  };

  const autoScroll = () => {
    const pointer = autoScrollPointerRef.current;
    const viewport = viewportRef.current;
    if (!pointer || !viewport) {
      autoScrollFrameRef.current = undefined;
      return;
    }
    const bounds = viewport.getBoundingClientRect();
    const left = getAutoScrollDelta(pointer.x, bounds.left, bounds.right);
    const top = getAutoScrollDelta(pointer.y, bounds.top, bounds.bottom);
    if (!left && !top) {
      autoScrollFrameRef.current = undefined;
      return;
    }
    const limit = autoScrollLimitRef.current ?? { x: viewport.scrollWidth - viewport.clientWidth, y: viewport.scrollHeight - viewport.clientHeight };
    const nextLeft = clampScroll(viewport.scrollLeft + left, limit.x);
    const nextTop = clampScroll(viewport.scrollTop + top, limit.y);
    if (nextLeft === viewport.scrollLeft && nextTop === viewport.scrollTop) {
      autoScrollFrameRef.current = undefined;
      return;
    }
    viewport.scrollTo({ left: nextLeft, top: nextTop });
    updateSelectionDrag(pointer.x, pointer.y);
    if (pointerDragRef.current) updateDraggedBlocks(pointerDragRef.current);
    autoScrollFrameRef.current = window.requestAnimationFrame(autoScroll);
  };

  const startAutoScroll = (clientX: number, clientY: number) => {
    autoScrollPointerRef.current = { x: clientX, y: clientY };
    if (autoScrollFrameRef.current === undefined) autoScrollFrameRef.current = window.requestAnimationFrame(autoScroll);
  };

  const setAutoScrollLimit = () => {
    const viewport = viewportRef.current;
    if (!viewport) return;
    autoScrollLimitRef.current = {
      x: viewport.scrollWidth - viewport.clientWidth,
      y: viewport.scrollHeight - viewport.clientHeight,
    };
  };

  useEffect(() => () => stopAutoScroll(), []);

  const finishSelecting = (canvas: HTMLDivElement, pointerId: number, shouldSelect = true) => {
    const drag = selectionDragRef.current;
    if (!drag) return;
    if (canvas.hasPointerCapture(pointerId)) canvas.releasePointerCapture(pointerId);
    stopAutoScroll();
    selectionDragRef.current = undefined;
    setSelectionDrag(undefined);
    if (!shouldSelect) return;

    const canvasBounds = canvas.getBoundingClientRect();
    const selection: Bounds = {
      left: canvasBounds.left + Math.min(drag.startX, drag.currentX),
      top: canvasBounds.top + Math.min(drag.startY, drag.currentY),
      right: canvasBounds.left + Math.max(drag.startX, drag.currentX),
      bottom: canvasBounds.top + Math.max(drag.startY, drag.currentY),
    };
    onSelectedBlockIdsChange([...nodeElementsRef.current.entries()]
      .filter(([, element]) => {
        const bounds = element.getBoundingClientRect();
        return boundsOverlap(selection, bounds);
      })
      .map(([blockId]) => blockId));
  };

  const selectionStyle = selectionDrag
    ? {
        left: Math.min(selectionDrag.startX, selectionDrag.currentX),
        top: Math.min(selectionDrag.startY, selectionDrag.currentY),
        width: Math.abs(selectionDrag.currentX - selectionDrag.startX),
        height: Math.abs(selectionDrag.currentY - selectionDrag.startY),
      }
    : undefined;

  return (
    <div
      className="flow-canvas-scroll"
      ref={viewportRef}
      onContextMenu={(event) => event.preventDefault()}
      onPointerDown={(event) => {
        if (event.button !== 2) return;
        event.preventDefault();
        event.currentTarget.setPointerCapture(event.pointerId);
        panDragRef.current = { startX: event.clientX, startY: event.clientY, scrollLeft: event.currentTarget.scrollLeft, scrollTop: event.currentTarget.scrollTop };
        event.currentTarget.classList.add("is-panning");
      }}
      onPointerMove={(event) => {
        const drag = panDragRef.current;
        if (!drag) return;
        const next = getPannedScroll(drag, event.clientX, event.clientY);
        event.currentTarget.scrollLeft = next.left;
        event.currentTarget.scrollTop = next.top;
      }}
      onPointerUp={(event) => finishPanning(event.currentTarget, event.pointerId)}
      onPointerCancel={(event) => finishPanning(event.currentTarget, event.pointerId)}
    >
      <div
        className="flow-canvas"
        ref={canvasRef}
        style={canvasStyle}
        onPointerDown={(event) => {
          if (event.button !== 0 || (event.target instanceof Element && event.target.closest(".node-wrap"))) return;
          event.preventDefault();
          const canvasBounds = event.currentTarget.getBoundingClientRect();
          const drag = { startX: event.clientX - canvasBounds.left, startY: event.clientY - canvasBounds.top, currentX: event.clientX - canvasBounds.left, currentY: event.clientY - canvasBounds.top };
          event.currentTarget.setPointerCapture(event.pointerId);
          setAutoScrollLimit();
          selectionDragRef.current = drag;
          setSelectionDrag(drag);
        }}
        onPointerMove={(event) => {
          const drag = selectionDragRef.current;
          if (!drag) return;
          updateSelectionDrag(event.clientX, event.clientY);
          startAutoScroll(event.clientX, event.clientY);
        }}
        onPointerUp={(event) => finishSelecting(event.currentTarget, event.pointerId)}
        onPointerCancel={(event) => finishSelecting(event.currentTarget, event.pointerId, false)}
      >
        <div className="canvas-direction" aria-hidden="true">흐름은 오른쪽으로 이어집니다 →</div>
        <svg className="connection-layer" viewBox={`0 0 ${canvasSize.width} ${canvasSize.height}`} preserveAspectRatio="none" aria-hidden="true">
          {connectionPaths.map((path) => <path d={path.d} key={`${path.from}-${path.to}`} />)}
        </svg>
        {selectionStyle && <div className="selection-marquee" style={selectionStyle} aria-hidden="true" />}
        {lanes.map(({ branch, startColumn }) => {
          const isRoot = branch.id === flow.rootBranchId;
          const laneStyle = { "--lane-start": startColumn } as CSSProperties;
          return (
            <section className={`flow-lane ${isRoot ? "is-root" : ""}`} style={laneStyle} key={branch.id}>
              {isRoot && <header className="lane-header"><span className="lane-label">주 흐름</span></header>}
              <div className="lane-nodes">
                {branch.itemIds.map((blockId, index) => {
                  const block = workspace.blocks.get(blockId);
                  if (!block) return null;
                  const nodePosition = nodePositions[blockId] ?? { x: 0, y: 0 };
                  const nodeWrapStyle = { "--node-offset-x": `${nodePosition.x}px`, "--node-offset-y": `${nodePosition.y}px` } as CSSProperties;
                  return (
                    <div className="node-wrap" style={nodeWrapStyle} key={blockId}>
                      <article
                        ref={(element) => { if (element) nodeElementsRef.current.set(blockId, element); else nodeElementsRef.current.delete(blockId); }}
                        className={`flow-node ${selectedBlockIdSet.has(blockId) ? "is-selected" : ""}`}
                        role="button"
                        tabIndex={0}
                        onClick={() => { if (!suppressClickRef.current) { onSelectedBlockIdsChange([blockId]); onOpenBlock(blockId); } }}
                        onPointerDown={(event) => {
                          if (event.target instanceof HTMLInputElement || event.button !== 0) return;
                          event.currentTarget.setPointerCapture(event.pointerId);
                          const blockIds = selectedBlockIdSet.has(blockId) ? selectedBlockIds : [blockId];
                          if (!selectedBlockIdSet.has(blockId)) onSelectedBlockIdsChange(blockIds);
                          setAutoScrollLimit();
                          pointerDragRef.current = {
                            blockIds,
                            startX: event.clientX,
                            startY: event.clientY,
                            currentX: event.clientX,
                            currentY: event.clientY,
                            scrollLeft: viewportRef.current?.scrollLeft ?? 0,
                            scrollTop: viewportRef.current?.scrollTop ?? 0,
                            positions: Object.fromEntries(blockIds.map((id) => [id, nodePositions[id] ?? { x: 0, y: 0 }])),
                            moved: false,
                          };
                        }}
                        onPointerMove={(event) => {
                          const drag = pointerDragRef.current;
                          if (!drag || !drag.blockIds.includes(blockId)) return;
                          drag.currentX = event.clientX;
                          drag.currentY = event.clientY;
                          updateDraggedBlocks(drag);
                          startAutoScroll(event.clientX, event.clientY);
                        }}
                        onPointerUp={(event) => {
                          const drag = pointerDragRef.current;
                          if (drag?.blockIds.includes(blockId) && drag.moved) { suppressClickRef.current = true; window.setTimeout(() => { suppressClickRef.current = false; }, 0); }
                          if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
                          pointerDragRef.current = undefined;
                          stopAutoScroll();
                        }}
                        onPointerCancel={() => { pointerDragRef.current = undefined; stopAutoScroll(); }}
                        onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); onOpenBlock(blockId); } }}
                        aria-label={`${getDisplayTitle(block)} 편집`}
                      >
                        <input className="node-title-input" value={block.title ?? ""} onClick={(event) => event.stopPropagation()} onKeyDown={(event) => event.stopPropagation()} onChange={(event) => onRenameBlock(blockId, event.currentTarget.value)} placeholder={getDisplayTitle(block)} aria-label="노드 제목 바로 편집" />
                      </article>
                      <div className="node-quick-actions">
                        {index === branch.itemIds.length - 1 && <button className="node-action" type="button" onClick={() => onAddAfter(blockId)} aria-label="다음 노드 추가" title="다음 노드 추가">+</button>}
                        <button className="node-action" type="button" onClick={() => onCreateBranch(blockId)} aria-label="갈래 만들기" title="갈래 만들기">⑂</button>
                      </div>
                    </div>
                  );
                })}
                <div className="node-wrap" >
                {branch.itemIds.length === 0 && <button className="empty-lane-add" type="button" onClick={() => onAddAfter()}>첫 노드 만들기</button>}
                </div>
              </div>
            </section>
          );
        })}
      </div>
    </div>
  );
}
