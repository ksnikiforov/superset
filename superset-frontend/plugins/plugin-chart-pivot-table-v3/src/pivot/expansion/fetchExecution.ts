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
import { parsePath } from '../core/path';
import { type ChartDataWarning } from '../data/ChartDataClient';
import { type LayoutContext } from '../layout/LayoutContext';
import {
  optimizeFetchPlan,
  type BatchCandidate,
  type BatchGroup,
  type FetchTarget,
} from '../query/fetchPlanOptimizer';
import { buildFactValueKeys, type PivotFactStore } from '../runtime/factStore';
import { type LatestRequestScope } from '../runtime/requestLifecycle';
import { createExpansionCoverageDiff } from '../runtime/coverage';
import { stableStringify } from '../shared/stableStringify';
import { runHydrationLoop } from './stateTransitions';
import {
  type ExpansionFetchTarget,
  type IntersectionFetchTarget,
  isIntersectionFetchTarget,
} from './planner';
import { rootKey } from '../viewModel';
import {
  fetchPivotExpansion,
  type FetchPivotExpansionRequest,
} from './fetchPivotExpansion';

export type ExpansionFetchRuntime = {
  requestScope: LatestRequestScope;
  instanceId: string;
  fetchFormData: PivotTableQueryFormData;
  layout: LayoutContext;
  factStore?: PivotFactStore;
  materializeLoadedTree: () => PivotTreeData;
  addWarnings: (nextWarnings?: ChartDataWarning[]) => void;
  updateLoadingKey: (key: string, delta: number) => void;
};

export type ExpansionFetchContext = {
  visibleRowDepth: number;
  visibleColDepth: number;
};

type ExpansionQueryRequest = Omit<
  FetchPivotExpansionRequest,
  'formData' | 'requestGroupId' | 'factStore'
>;

const buildExpansionRequestGroupId = ({
  runtime,
  payload,
}: {
  runtime: ExpansionFetchRuntime;
  payload: Record<string, unknown>;
}) =>
  stableStringify({
    instanceId: runtime.instanceId,
    transactionId: runtime.requestScope.id,
    ...payload,
  });

const createRuntimeExpansionCoverageDiff = ({
  runtime,
}: {
  runtime: ExpansionFetchRuntime;
}) =>
  createExpansionCoverageDiff({
    factSelectors: runtime.factStore?.getCoverageSelectors() ?? [],
    program: runtime.layout.pivotProgram,
    valueKeys: buildFactValueKeys({
      metricKeys: runtime.layout.pivotProgram.metricKeys,
    }),
  });

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

const executeExpansionQueryRequest = async ({
  request,
  requestGroupId,
  runtime,
  loadingKeys,
}: {
  request: ExpansionQueryRequest;
  requestGroupId: string;
  runtime: ExpansionFetchRuntime;
  loadingKeys: string[];
}): Promise<void> => {
  const { requestScope, updateLoadingKey, addWarnings } = runtime;
  if (requestScope.isCurrent()) {
    loadingKeys.forEach(key => updateLoadingKey(key, 1));
  }
  const token = requestScope.beginRequest(requestGroupId);
  try {
    const result = await fetchPivotExpansion({
      ...request,
      layout: runtime.layout,
      requestGroupId,
      formData: runtime.fetchFormData,
      factStore: runtime.factStore,
    });
    if (requestScope.isCurrent()) {
      addWarnings(result.warnings);
    }
  } finally {
    requestScope.finish(token);
    if (requestScope.isCurrent()) {
      loadingKeys.forEach(key => updateLoadingKey(key, -1));
    }
  }
};

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
}): Promise<boolean> => {
  const { batches, singles, intersections } = resolveExpansionFetchPlan({
    targets,
    visibleRowDepth: context.visibleRowDepth,
    visibleColDepth: context.visibleColDepth,
  });
  const { visibleRowDepth, visibleColDepth } = context;
  const buildSingleRequestGroupId = (target: FetchTarget) =>
    buildExpansionRequestGroupId({
      runtime,
      payload: {
        kind: 'branch',
        ...target,
        visibleRowDepth,
        visibleColDepth,
      },
    });
  const buildBatchRequestGroupId = (batch: BatchGroup) =>
    buildExpansionRequestGroupId({
      runtime,
      payload: {
        kind: 'batch',
        axis: batch.axis,
        parentPathKey: batch.parentPathKey,
        signature: batch.signature,
        targetKeys: [...batch.targets.map(target => target.pathKey)].sort(),
        visibleRowDepth,
        visibleColDepth,
      },
    });
  const buildIntersectionRequestGroupId = (target: IntersectionFetchTarget) =>
    buildExpansionRequestGroupId({
      runtime,
      payload: {
        kind: 'hydrate:intersection',
        rowPathKeys: [...target.rowPathKeys].sort(),
        columnPathKeys: [...target.columnPathKeys].sort(),
        visibleRowDepth,
        visibleColDepth,
      },
    });
  const branchFetchPromises: Array<Promise<void>> = [
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
      }),
    ),
  ];
  await Promise.all(branchFetchPromises);
  if (!runtime.requestScope.isCurrent()) {
    return false;
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
      }),
    ),
  );
  if (!runtime.requestScope.isCurrent()) {
    return false;
  }
  return branchFetchPromises.length + intersectionResults.length > 0;
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
      }),
    fetchTree: async ({ targets, context, tree }) => {
      const didFetch = await fetchExpansionTargetDeltas({
        targets,
        context,
        runtime: fetchRuntime,
      });
      return didFetch ? fetchRuntime.materializeLoadedTree() : tree;
    },
  });
