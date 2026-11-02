import type { Topology } from "@steed/api/shared";
import type { TopologyLayoutOptions } from "./topology-layout";
import type { RouterOptions } from "./topology-router";
import { computeTopologyLayout } from "./topology-layout-compute";

export interface LayoutWorkerRequest {
  requestId: string;
  layoutVersion: number;
  topology: Topology;
  viewId?: string;
  pins?: TopologyLayoutOptions["pins"];
  options?: TopologyLayoutOptions;
  routerOptions?: RouterOptions;
}

export interface LayoutWorkerResponse {
  requestId: string;
  layoutVersion: number;
  ok: true;
  result: ReturnType<typeof computeTopologyLayout>;
}

export interface LayoutWorkerFailure {
  requestId: string;
  layoutVersion: number;
  ok: false;
  message: string;
}

const scope = self as unknown as {
  onmessage: ((event: MessageEvent<LayoutWorkerRequest>) => void) | null;
  postMessage: (message: LayoutWorkerResponse | LayoutWorkerFailure) => void;
};
scope.onmessage = (event) => {
  const input = event.data;
  try {
    const options: TopologyLayoutOptions = {
      ...(input.options ?? {}),
      ...(input.viewId ? { viewId: input.viewId } : {}),
      ...(input.pins ? { pins: input.pins } : {}),
    };
    const result = computeTopologyLayout(input.topology, options, input.routerOptions);
    scope.postMessage({
      requestId: input.requestId,
      layoutVersion: input.layoutVersion,
      ok: true,
      result,
    } satisfies LayoutWorkerResponse);
  } catch (error) {
    scope.postMessage({
      requestId: input.requestId,
      layoutVersion: input.layoutVersion,
      ok: false,
      message: error instanceof Error ? error.message : "Layout worker failed",
    } satisfies LayoutWorkerFailure);
  }
};
