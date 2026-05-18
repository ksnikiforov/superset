/**
 * Licensed to the Apache Software Foundation (ASF) under one
 * or more contributor license agreements.  See the NOTICE file
 * distributed with this work for additional information
 * regarding copyright ownership.  The ASF licenses this file
 * to you under the Apache License, Version 2.0 (the
 * "License"); you may not use this file except in compliance
 * with the License.  You may obtain a copy of the License at
 *
 *   http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing,
 * software distributed under the License is distributed on an
 * "AS IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY
 * KIND, either express or implied.  See the License for the
 * specific language governing permissions and limitations
 * under the License.
 */
import { type PivotTableQueryFormData, type PivotTreeData } from '../../types';
import { buildLayoutContext } from '../layout/LayoutContext';
import { parsePath } from '../core/path';
import { type ChartDataWarning } from '../data/ChartDataClient';
import {
  optimizeFetchPlan,
  type BatchCandidate,
  type BatchGroup,
  type FetchTarget,
} from '../query/fetchPlanOptimizer';
import {
  buildExpansionQuerySpecs,
  type ExpansionQuerySpecRequest,
} from '../query/specs';
import { buildFactValueKeys, type PivotFactStore } from '../runtime/factStore';
import {
  collectPlannedQueryWarnings,
  fetchPlannedQuerySpecs,
} from '../runtime/ingestQueryResults';
import {
  type LatestRequestLifecycle,
  type LatestRequestScope,
  isAbortError,
} from '../runtime/requestLifecycle';
import { createExpansionCoverageDiff } from '../runtime/coverage';
import { stableStringify } from '../shared/stableStringify';
import { runHydrationLoop } from './stateTransitions';
import {
  type ExpansionFetchTarget,
  type IntersectionFetchTarget,
  isIntersectionFetchTarget,
} from './planner';
import type { PivotProgram } from '../runtime/types';
import { rootKey } from '../viewModel';

type ExpansionFetchResult = {
  targets: ExpansionFetchTarget[];
};

export type TrackExpansionRequest = <T>(
  requestScope: LatestRequestScope,
  requestGroupId: string,
  fetcher: () => Promise<T>,
) => Promise<T>;

type BuildExpansionRequestGroupId = (
  payload: Record<string, unknown>,
) => string;

export type ExpansionRequestHelpers = {
  buildRequestGroupId: BuildExpansionRequestGroupId;
  trackRequestInScope: TrackExpansionRequest;
};

export const createExpansionRequestHelpers = ({
  lifecycle,
  instanceId,
}: {
  lifecycle: LatestRequestLifecycle;
  instanceId: string;
}): ExpansionRequestHelpers => ({
  buildRequestGroupId(payload: Record<string, unknown>) {
    return stableStringify({
      instanceId,
      transactionId: lifecycle.currentId(),
      ...payload,
    });
  },
  async trackRequestInScope<T>(
    requestScope: LatestRequestScope,
    requestGroupId: string,
    fetcher: () => Promise<T>,
  ): Promise<T> {
    const token = requestScope.beginRequest(requestGroupId);
    try {
      return await fetcher();
    } finally {
      lifecycle.finish(token);
    }
  },
});

export type ExpansionFetchRuntime = {
  requestScope: LatestRequestScope;
  fetchFormData: PivotTableQueryFormData;
  program: PivotProgram;
  factStore?: PivotFactStore;
  materializeLoadedTree: () => PivotTreeData;
  buildRequestGroupId: BuildExpansionRequestGroupId;
  trackRequestInScope: TrackExpansionRequest;
  addWarnings: (nextWarnings?: ChartDataWarning[]) => void;
  updateLoadingKey: (key: string, delta: number) => void;
};

export type ExpansionFetchContext = {
  visibleRowDepth: number;
  visibleColDepth: number;
};

export type ExpansionFetchedTargetGroup = {
  targets: ExpansionFetchTarget[];
};

export interface FetchPivotExpansionResult {
  warnings?: ChartDataWarning[];
  error?: Error;
}

type ExpansionQuerySpecRequestWithoutLayout =
  ExpansionQuerySpecRequest extends infer Request
    ? Request extends unknown
      ? Omit<Request, 'layout'>
      : never
    : never;

export type FetchPivotExpansionRequest =
  ExpansionQuerySpecRequestWithoutLayout & {
    requestGroupId?: string;
    factStore?: PivotFactStore;
  };

type ExpansionFetcherResult = {
  warnings?: ChartDataWarning[];
  error?: unknown;
};

type ExpansionQueryRequest = Omit<
  FetchPivotExpansionRequest,
  'formData' | 'requestGroupId' | 'factStore'
>;

const createRuntimeExpansionCoverageDiff = ({
  runtime,
  program,
}: {
  runtime: ExpansionFetchRuntime;
  program: PivotProgram;
}) =>
  createExpansionCoverageDiff({
    factSelectors: runtime.factStore?.getCoverageSelectors() ?? [],
    program,
    valueKeys: buildFactValueKeys({
      metricKeys: program.metricKeys,
    }),
  });

export const fetchPivotExpansion = async (
  request: FetchPivotExpansionRequest,
): Promise<FetchPivotExpansionResult> => {
  const layout = buildLayoutContext(request.formData);
  const specs = buildExpansionQuerySpecs({ ...request, layout });

  try {
    const { results } = await fetchPlannedQuerySpecs({
      formData: request.formData,
      specs,
      requestGroupId: request.requestGroupId,
      factStore: request.factStore,
    });
    const warnings = collectPlannedQueryWarnings(results);
    return {
      ...(warnings.length > 0 ? { warnings } : {}),
    };
  } catch (error) {
    if (isAbortError(error)) {
      return {};
    }
    return {
      error: error instanceof Error ? error : new Error(String(error)),
    };
  }
};

const resolveExpansionFetchPlan = ({
  targets,
  visibleRowDepth,
  visibleColDepth,
}: {
  targets: ExpansionFetchTarget[];
  visibleRowDepth: number;
  visibleColDepth: number;
}): {
  singles: FetchTarget[];
  batches: BatchGroup[];
  intersections: IntersectionFetchTarget[];
} => {
  const batchCandidates: BatchCandidate[] = [];
  for (const target of targets) {
    if (isIntersectionFetchTarget(target)) {
      continue;
    }
    const batchSignature = `${target.axis}|${visibleRowDepth}|${visibleColDepth}`;
    batchCandidates.push({ ...target, batchSignature });
  }
  const { batches, singles } = optimizeFetchPlan({
    targets: batchCandidates,
  });
  return {
    singles,
    batches,
    intersections: targets.filter(isIntersectionFetchTarget),
  };
};

const executeExpansionFetch = async ({
  runtime,
  requestGroupId,
  loadingKeys,
  targets,
  fetcher,
}: {
  runtime: ExpansionFetchRuntime;
  requestGroupId: string;
  loadingKeys: string[];
  targets: ExpansionFetchTarget[];
  fetcher: () => Promise<ExpansionFetcherResult>;
}): Promise<ExpansionFetchResult> => {
  const { requestScope, trackRequestInScope, updateLoadingKey, addWarnings } =
    runtime;
  if (requestScope.isCurrent()) {
    loadingKeys.forEach(key => updateLoadingKey(key, 1));
  }
  try {
    const result = await trackRequestInScope(
      requestScope,
      requestGroupId,
      fetcher,
    );
    if (requestScope.isCurrent()) {
      addWarnings(result.warnings);
      if (result.error) {
        throw result.error;
      }
    }
    return {
      targets,
    };
  } finally {
    if (requestScope.isCurrent()) {
      loadingKeys.forEach(key => updateLoadingKey(key, -1));
    }
  }
};

const executeExpansionQueryRequest = async ({
  request,
  requestGroupId,
  runtime,
  loadingKeys,
  targets,
}: {
  request: ExpansionQueryRequest;
  requestGroupId: string;
  runtime: ExpansionFetchRuntime;
  loadingKeys: string[];
  targets: ExpansionFetchTarget[];
}): Promise<ExpansionFetchResult> =>
  executeExpansionFetch({
    runtime,
    requestGroupId,
    loadingKeys,
    targets,
    fetcher: () =>
      fetchPivotExpansion({
        ...request,
        requestGroupId,
        formData: runtime.fetchFormData,
        factStore: runtime.factStore,
      }),
  });

const filterMissingIntersectionTargets = ({
  intersections,
  context,
  runtime,
}: {
  intersections: IntersectionFetchTarget[];
  context: ExpansionFetchContext;
  runtime: ExpansionFetchRuntime;
}) => {
  const missingRequests = createRuntimeExpansionCoverageDiff({
    runtime,
    program: runtime.program,
  })(
    intersections.map(target => ({
      axis: 'row' as const,
      pathKey: rootKey,
      rowDepth: context.visibleRowDepth,
      columnDepth: context.visibleColDepth,
      rowPathKeys: target.rowPathKeys,
      columnPathKeys: target.columnPathKeys,
    })),
  );
  const missingKeys = new Set(
    missingRequests.map(request =>
      stableStringify([
        request.rowPathKeys ?? [],
        request.columnPathKeys ?? [],
      ]),
    ),
  );
  return intersections.filter(target =>
    missingKeys.has(
      stableStringify([target.rowPathKeys, target.columnPathKeys]),
    ),
  );
};

export const fetchExpansionTargetDeltas = async ({
  targets,
  context,
  runtime,
}: {
  targets: ExpansionFetchTarget[];
  context: ExpansionFetchContext;
  runtime: ExpansionFetchRuntime;
}): Promise<ExpansionFetchedTargetGroup[]> => {
  const { batches, singles, intersections } = resolveExpansionFetchPlan({
    targets,
    visibleRowDepth: context.visibleRowDepth,
    visibleColDepth: context.visibleColDepth,
  });
  const { visibleRowDepth, visibleColDepth } = context;
  const buildSingleRequestGroupId = (target: FetchTarget) =>
    runtime.buildRequestGroupId({
      kind: 'branch',
      ...target,
      visibleRowDepth,
      visibleColDepth,
    });
  const buildBatchRequestGroupId = (batch: BatchGroup) =>
    runtime.buildRequestGroupId({
      kind: 'batch',
      axis: batch.axis,
      parentPathKey: batch.parentPathKey,
      signature: batch.signature,
      targetKeys: [...batch.targets.map(target => target.pathKey)].sort(),
      visibleRowDepth,
      visibleColDepth,
    });
  const buildIntersectionRequestGroupId = (target: IntersectionFetchTarget) =>
    runtime.buildRequestGroupId({
      kind: 'hydrate:intersection',
      rowPathKeys: [...target.rowPathKeys].sort(),
      columnPathKeys: [...target.columnPathKeys].sort(),
      visibleRowDepth,
      visibleColDepth,
    });
  const branchFetchPromises: Array<Promise<ExpansionFetchResult>> = [
    ...singles.map(target =>
      executeExpansionQueryRequest({
        request: {
          kind: 'branch',
          axis: target.axis,
          path: parsePath(target.pathKey),
          visibleRowDepth,
          visibleColDepth,
        },
        requestGroupId: buildSingleRequestGroupId(target),
        runtime,
        loadingKeys: [target.pathKey],
        targets: [target],
      }),
    ),
    ...batches.map(batch =>
      executeExpansionQueryRequest({
        request: {
          kind: 'batch',
          batch,
          visibleRowDepth,
          visibleColDepth,
        },
        requestGroupId: buildBatchRequestGroupId(batch),
        runtime,
        loadingKeys: batch.targets.map(target => target.pathKey),
        targets: batch.targets,
      }),
    ),
  ];
  const branchResults = await Promise.all(branchFetchPromises);
  if (!runtime.requestScope.isCurrent()) {
    return [];
  }
  const missingIntersections = filterMissingIntersectionTargets({
    intersections,
    context,
    runtime,
  });
  const intersectionResults = await Promise.all(
    missingIntersections.map(target =>
      executeExpansionQueryRequest({
        request: {
          kind: 'intersection',
          rowPathKeys: target.rowPathKeys,
          columnPathKeys: target.columnPathKeys,
          visibleRowDepth,
          visibleColDepth,
        },
        requestGroupId: buildIntersectionRequestGroupId(target),
        runtime,
        loadingKeys: [...target.rowPathKeys, ...target.columnPathKeys],
        targets: [
          ...target.rowPathKeys.map(pathKey => ({
            axis: 'row' as const,
            pathKey,
          })),
          ...target.columnPathKeys.map(pathKey => ({
            axis: 'col' as const,
            pathKey,
          })),
        ],
      }),
    ),
  );
  const results = [...branchResults, ...intersectionResults];
  if (!runtime.requestScope.isCurrent()) {
    return [];
  }
  return results.map(result => ({ targets: result.targets }));
};

type HydrationLoopParams = Parameters<typeof runHydrationLoop>[0];

export const runHydrationExpansionFetchLoop = ({
  fetchRuntime,
  ...hydrationLoopParams
}: Omit<HydrationLoopParams, 'fetchTree' | 'getMissingExpansionCoverage'> & {
  fetchRuntime: ExpansionFetchRuntime;
}) =>
  runHydrationLoop({
    ...hydrationLoopParams,
    getMissingExpansionCoverage: () =>
      createRuntimeExpansionCoverageDiff({
        runtime: fetchRuntime,
        program: hydrationLoopParams.config.program,
      }),
    fetchTree: async ({ targets, context, tree }) => {
      const deltas = await fetchExpansionTargetDeltas({
        targets,
        context,
        runtime: fetchRuntime,
      });
      return deltas.length > 0 ? fetchRuntime.materializeLoadedTree() : tree;
    },
  });
