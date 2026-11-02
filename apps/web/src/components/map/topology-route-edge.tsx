import { useLayoutEffect, useRef, useState } from "react";
import { BaseEdge, EdgeLabelRenderer, useStore, type Edge, type EdgeProps } from "@xyflow/react";
import {
  TopologyFallbackRectIndex,
  splitTopologyFallbackPolylineIndexed,
  splitTopologyFallbackPolylinePreview,
  topologyFallbackMarkerVisibility,
} from "@/lib/topology-route-edge-safety";
import {
  topologyRouteDash,
  topologyRouteEdgeColor,
  topologyRouteLabelDetail,
  topologyRouteLabelText,
  topologyRoutePointsValid,
  topologyRouteSafeLabelPosition,
  topologySafeRoundedOrthogonalPath,
  topologyRouteStrokeWidth,
  type TopologyRouteEdgeData,
} from "@/lib/topology-route-edge";

export type TopologyRouteEdgeType = Edge<TopologyRouteEdgeData, "topologyRoute">;

function TopologyRouteMeasuredLabel(props: {
  segments: Array<{ a: { x: number; y: number }; b: { x: number; y: number } }>;
  fallbackIndex: TopologyFallbackRectIndex;
  sourceId: string;
  targetId: string;
  text: string;
  detail: string;
  fallback?: boolean;
  preview?: boolean;
  pointerEvents?: "auto" | "none";
}) {
  const labelRef = useRef<HTMLButtonElement>(null);
  const zoom = useStore((state) => state.transform[2] || 1);
  const segmentKey = JSON.stringify(props.segments);
  const conservativePosition = topologyRouteSafeLabelPosition(props.segments, props.fallbackIndex, props.sourceId, props.targetId, props.text);
  const [measurement, setMeasurement] = useState<{
    index: TopologyFallbackRectIndex;
    segmentsKey: string;
    sourceId: string;
    targetId: string;
    text: string;
    zoom: number;
    measured: boolean;
    position: { x: number; y: number } | null;
  } | null>(null);

  useLayoutEffect(() => {
    setMeasurement(null);
    const element = labelRef.current;
    if (!element) return;
    const rect = element.getBoundingClientRect();
    const measuredWidth = rect.width / zoom;
    const measuredHeight = rect.height / zoom;
    if (!Number.isFinite(measuredWidth) || !Number.isFinite(measuredHeight) || measuredWidth <= 0 || measuredHeight <= 0) {
      setMeasurement({
        index: props.fallbackIndex,
        segmentsKey: segmentKey,
        sourceId: props.sourceId,
        targetId: props.targetId,
        text: props.text,
        zoom,
        measured: true,
        position: null,
      });
      return;
    }
    const exactPosition = topologyRouteSafeLabelPosition(
      props.segments,
      props.fallbackIndex,
      props.sourceId,
      props.targetId,
      props.text,
      measuredHeight,
      measuredWidth,
    );
    setMeasurement({
      index: props.fallbackIndex,
      segmentsKey: segmentKey,
      sourceId: props.sourceId,
      targetId: props.targetId,
      text: props.text,
      zoom,
      measured: true,
      position: exactPosition,
    });
  }, [props.fallbackIndex, props.sourceId, props.targetId, props.text, zoom, segmentKey]);

  const measurementMatches = measurement !== null
    && measurement.index === props.fallbackIndex
    && measurement.segmentsKey === segmentKey
    && measurement.sourceId === props.sourceId
    && measurement.targetId === props.targetId
    && measurement.text === props.text
    && measurement.zoom === zoom;
  const position = measurementMatches ? measurement.position : conservativePosition;
  const measured = measurementMatches ? measurement.measured : false;

  const renderedPosition = position ?? { x: 0, y: 0 };
  const ariaLabel = props.preview
    ? `${props.text} fallback preview`
    : props.fallback
      ? `${props.text} fallback`
      : props.text;
  return (
    <EdgeLabelRenderer>
      <button
        ref={labelRef}
        type="button"
        className="nopan topology-route-edge-label pointer-events-auto absolute whitespace-nowrap rounded-full border border-basalt-border bg-basalt-card px-2 py-1 text-[11px] font-medium text-basalt-card-foreground shadow-sm"
        style={{
          transform: `translate(-50%, -50%) translate(${renderedPosition.x}px, ${renderedPosition.y}px)`,
          pointerEvents: props.pointerEvents ?? "auto",
          visibility: measured && position !== null ? "visible" : "hidden",
        }}
        aria-label={ariaLabel}
        data-fallback-preview-label={props.preview ? "true" : undefined}
        data-fallback-label={props.fallback && !props.preview ? "true" : undefined}
      >
        {props.detail ? <>{props.text.slice(0, -props.detail.length)}<span className="font-mono">{props.detail}</span></> : props.text}
      </button>
    </EdgeLabelRenderer>
  );
}

export function TopologyRouteEdge(props: Pick<EdgeProps<TopologyRouteEdgeType>, "id" | "data" | "selected" | "style" | "markerStart" | "markerEnd">) {
  const data = props.data;
  const edge = data?.edge;
  if (!data || !edge) return <EdgeLabelRenderer><span className="pointer-events-none absolute" data-diagnostic="geometry-unavailable" data-edge-id={props.id} aria-label="Routing geometry unavailable" /></EdgeLabelRenderer>;
  const suppliedPoints = data.points;
  if (!topologyRoutePointsValid(suppliedPoints)) {
    return (
      <EdgeLabelRenderer>
        <span
          className="pointer-events-none absolute"
          style={{ transform: `translate(-50%, -50%) translate(0px, 0px)` }}
          data-testid={`topology-route-geometry-unavailable-${props.id}`}
          data-diagnostic="geometry-unavailable"
          aria-label="Routing geometry unavailable"
          data-edge-id={props.id}
          data-edge-source={edge.source}
          data-edge-target={edge.target}
        />
      </EdgeLabelRenderer>
    );
  }
  const points = suppliedPoints;
  const isFallback = props.data?.status === "fallback" || props.data?.renderMode === "straight";
  const path = isFallback
    ? ""
    : topologySafeRoundedOrthogonalPath(points, props.data?.fallbackIndex, edge.source, edge.target);
  const edgeLabelText = topologyRouteLabelText(edge);
  const edgeLabelDetail = topologyRouteLabelDetail(edge);
  const fallbackIndex = data.fallbackIndex;
  const routeSegments = points.slice(0, -1).flatMap((a, index) => {
    const b = points[index + 1];
    return b ? [{ a, b }] : [];
  });
  const labelPosition = topologyRouteSafeLabelPosition(routeSegments, data.fallbackIndex, edge.source, edge.target, edgeLabelText);
  const diagnosticPosition = labelPosition ?? { x: 0, y: 0 };
  const crossLayer = props.data?.crossLayer === true;
  const highlight = props.selected === true;
  const dash = topologyRouteDash(edge);
  const animated = edge.style?.animated === true;

  if (isFallback) {
    const fallbackIndex = props.data?.fallbackIndex;
    if (!fallbackIndex) {
      return (
        <EdgeLabelRenderer>
          <span
            className="pointer-events-none absolute"
            style={{ transform: `translate(-50%, -50%) translate(${diagnosticPosition.x}px, ${diagnosticPosition.y}px)` }}
            data-testid={`topology-fallback-geometry-unavailable-${props.id}`}
            data-diagnostic="geometry-unavailable"
            aria-label="Routing fallback geometry unavailable"
          />
        </EdgeLabelRenderer>
      );
    }
    const split = splitTopologyFallbackPolylineIndexed(fallbackIndex, points, edge.source, edge.target, {
      strokeMargin: data.strokeMargin,
      clock: data.clock,
      deadline: data.deadline,
    });
    if (split.geometryUnavailable) {
      return (
        <EdgeLabelRenderer>
          <span
            className="pointer-events-none absolute"
            style={{ transform: `translate(-50%, -50%) translate(${diagnosticPosition.x}px, ${diagnosticPosition.y}px)` }}
            data-testid={`topology-fallback-geometry-unavailable-${props.id}`}
            data-diagnostic="geometry-unavailable"
            aria-label="Routing fallback geometry unavailable"
          />
        </EdgeLabelRenderer>
      );
    }
    if (split.timeout) {
      const preview = splitTopologyFallbackPolylinePreview(
        fallbackIndex,
        points,
        edge.source,
        edge.target,
        { strokeMargin: data.strokeMargin },
      );
      if (preview.geometryUnavailable) {
        return (
          <EdgeLabelRenderer>
            <span
              className="pointer-events-none absolute"
              style={{ transform: `translate(-50%, -50%) translate(${diagnosticPosition.x}px, ${diagnosticPosition.y}px)` }}
              data-testid={`topology-fallback-geometry-unavailable-${props.id}`}
              data-diagnostic="geometry-unavailable"
              aria-label="Routing fallback geometry unavailable"
            />
          </EdgeLabelRenderer>
        );
      }
      if (preview.timeout) {
        return (
          <EdgeLabelRenderer>
            <span
              className="pointer-events-none absolute"
              style={{ transform: `translate(-50%, -50%) translate(${diagnosticPosition.x}px, ${diagnosticPosition.y}px)` }}
              data-testid={`topology-fallback-preview-budget-${props.id}`}
              data-diagnostic="fallback-preview-candidate-limit"
              aria-label="Routing fallback preview exceeded candidate budget"
            />
          </EdgeLabelRenderer>
        );
      }
      if (preview.segments.length === 0) {
        return (
          <EdgeLabelRenderer>
            <span
              className="pointer-events-none absolute"
              style={{ transform: `translate(-50%, -50%) translate(${diagnosticPosition.x}px, ${diagnosticPosition.y}px)` }}
              data-testid={`topology-fallback-preview-safe-${props.id}`}
              data-diagnostic="fallback-preview-no-visible-segments"
              aria-label="Routing fallback has no safe straight segment"
            />
          </EdgeLabelRenderer>
        );
      }
      const source = points[0];
      const target = points.at(-1);
      const markerVisibility = source && target
        ? topologyFallbackMarkerVisibility(preview.segments, source, target, {
            index: fallbackIndex,
            strokeWidth: typeof props.style?.strokeWidth === "number" ? props.style.strokeWidth : topologyRouteStrokeWidth(edge, crossLayer),
            markerWidth: 14,
            markerHeight: 14,
            sourceId: edge.source,
            targetId: edge.target,
          })
        : { markerStart: false, markerEnd: false };
      const previewLabelPosition = topologyRouteSafeLabelPosition(preview.segments, fallbackIndex, edge.source, edge.target, edgeLabelText);
      const faded = data.fallbackStyle === "faded";
      return (
        <>
          {preview.segments.map((segment, index) => (
            <BaseEdge
              key={`${props.id}-fallback-preview-${index}`}
              id={`${props.id}-fallback-preview-${index}`}
              path={`M ${segment.a.x} ${segment.a.y} L ${segment.b.x} ${segment.b.y}`}
              markerStart={index === 0 && markerVisibility.markerStart && edge.direction === "bi" ? props.markerStart : undefined}
              markerEnd={index === preview.segments.length - 1 && markerVisibility.markerEnd ? props.markerEnd : undefined}
              interactionWidth={16}
              className={`topology-route-edge topology-route-edge-fallback topology-route-edge-preview${highlight ? " topology-route-edge-highlighted" : ""}`}
              data-fallback={data.fallback ?? "no_path"}
              data-diagnostic="fallback-preview"
              data-deferred="false"
              data-background-completion="none"
              data-fallback-style={data.fallbackStyle ?? "dashed"}
              data-visible-segments={preview.visibleSegmentCount}
              data-hidden-segments={preview.hiddenSegmentCount}
              style={{
                stroke: props.style?.stroke ?? topologyRouteEdgeColor(edge, crossLayer),
                strokeWidth: props.style?.strokeWidth ?? topologyRouteStrokeWidth(edge, crossLayer),
                strokeDasharray: "6 5",
                opacity: faded ? 0.35 : 0.65,
                strokeLinecap: "round",
              }}
            />
          ))}
          {data.showLabel !== false && previewLabelPosition !== null && (
            <TopologyRouteMeasuredLabel
              segments={preview.segments}
              fallbackIndex={fallbackIndex}
              sourceId={edge.source}
              targetId={edge.target}
              text={edgeLabelText}
              detail={edgeLabelDetail}
              fallback
              preview
              pointerEvents="none"
            />
          )}
        </>
      );
    }
    const source = points[0];
    const target = points.at(-1);
    const markerVisibility = source && target
      ? topologyFallbackMarkerVisibility(split.segments, source, target, {
          index: fallbackIndex,
          strokeWidth: typeof props.style?.strokeWidth === "number" ? props.style.strokeWidth : topologyRouteStrokeWidth(edge, crossLayer),
          markerWidth: 14,
          markerHeight: 14,
          sourceId: edge.source,
          targetId: edge.target,
        })
      : { markerStart: false, markerEnd: false };
    if (split.segments.length === 0) {
      return (
        <EdgeLabelRenderer>
          <span
            className="pointer-events-none absolute"
            style={{ transform: `translate(-50%, -50%) translate(${diagnosticPosition.x}px, ${diagnosticPosition.y}px)` }}
            data-testid={`topology-fallback-detailed-no-visible-${props.id}`}
            data-diagnostic="fallback-detailed-no-visible-segments"
            aria-label="Routing fallback has no visible safe segment"
            data-edge-id={props.id}
            data-edge-source={edge.source}
            data-edge-target={edge.target}
          />
        </EdgeLabelRenderer>
      );
    }
    const fallbackLabelPosition = topologyRouteSafeLabelPosition(split.segments, fallbackIndex, edge.source, edge.target, edgeLabelText);
    const faded = props.data?.fallbackStyle === "faded";

    return (
      <>
        {split.segments.map((segment, index) => (
          <BaseEdge
            key={`${props.id}-fallback-${index}`}
            id={`${props.id}-fallback-${index}`}
            path={`M ${segment.a.x} ${segment.a.y} L ${segment.b.x} ${segment.b.y}`}
            markerStart={index === 0 && markerVisibility.markerStart && edge.direction === "bi" ? props.markerStart : undefined}
            markerEnd={index === split.segments.length - 1 && markerVisibility.markerEnd ? props.markerEnd : undefined}
            interactionWidth={16}
            className={`topology-route-edge topology-route-edge-fallback${highlight ? " topology-route-edge-highlighted" : ""}`}
            data-fallback={props.data?.fallback ?? "no_path"}
            data-diagnostic="visible-fallback"
            data-fallback-style={props.data?.fallbackStyle ?? "dashed"}
            data-checked-rect-count={split.checkedRectCount}
            data-visible-segments={split.visibleSegmentCount}
            data-hidden-segments={split.hiddenSegmentCount}
            style={{
              stroke: props.style?.stroke ?? topologyRouteEdgeColor(edge, crossLayer),
              strokeWidth: props.style?.strokeWidth ?? topologyRouteStrokeWidth(edge, crossLayer),
              strokeDasharray: "6 5",
              opacity: faded ? 0.35 : 0.65,
              strokeLinecap: "round",
            }}
          />
        ))}
        {props.data?.showLabel !== false && fallbackLabelPosition !== null && (
          <TopologyRouteMeasuredLabel
            segments={split.segments}
            fallbackIndex={fallbackIndex}
            sourceId={edge.source}
            targetId={edge.target}
            text={edgeLabelText}
            detail={edgeLabelDetail}
            fallback
            pointerEvents="none"
          />
        )}
      </>
    );
  }

  return (
    <>
      <BaseEdge
        id={props.id}
        path={path}
        markerStart={props.markerStart}
        markerEnd={props.markerEnd}
        interactionWidth={16}
        className={`topology-route-edge${highlight ? " topology-route-edge-highlighted" : ""}${animated ? " topology-route-edge-animated" : ""}`}
        style={{
          stroke: props.style?.stroke ?? topologyRouteEdgeColor(edge, crossLayer),
          strokeWidth: props.style?.strokeWidth ?? topologyRouteStrokeWidth(edge, crossLayer),
          strokeDasharray: props.style ? props.style.strokeDasharray : dash,
          strokeOpacity: props.style?.strokeOpacity ?? (crossLayer ? 0.55 : 0.8),
        }}
      />
      {props.data?.showLabel !== false && labelPosition !== null && fallbackIndex && (
        <TopologyRouteMeasuredLabel
          segments={routeSegments}
          fallbackIndex={fallbackIndex}
          sourceId={edge.source}
          targetId={edge.target}
          text={edgeLabelText}
          detail={edgeLabelDetail}
          pointerEvents="auto"
        />
      )}
    </>
  );
}
