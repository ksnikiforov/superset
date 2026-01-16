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
import { type ComponentProps, ReactNode } from 'react';
import { Metric } from '@superset-ui/core';
import { ColumnMeta } from '@superset-ui/chart-controls';
import {
  AdhocMetric,
  AdhocMetricPopoverTrigger,
  type savedMetricType,
} from '../../exploreImports';
import AdhocMetricOption from './AdhocMetricOption';

type SavedMetric = savedMetricType & { error_text?: string };
type MetricOption = Metric | AdhocMetric | string;
type AdhocMetricPopoverDatasource =
  ComponentProps<typeof AdhocMetricPopoverTrigger>['datasource'];

export type MetricDefinitionValueProps = {
  option: MetricOption;
  index: number;
  onMetricEdit: (
    changedMetric: Metric | AdhocMetric,
    oldMetric: Metric | AdhocMetric,
  ) => void;
  onRemoveMetric: (index: number) => void;
  onMoveLabel: (dragIndex: number, hoverIndex: number) => void;
  onDropLabel: () => void;
  columns: ColumnMeta[];
  savedMetrics: SavedMetric[];
  savedMetricsOptions: savedMetricType[];
  multi?: boolean;
  datasource?: AdhocMetricPopoverDatasource;
  datasourceWarningMessage?: string;
  type?: string;
  rightNode?: ReactNode;
};

export default function MetricDefinitionValue({
  option,
  onMetricEdit,
  onRemoveMetric,
  columns,
  savedMetrics,
  savedMetricsOptions,
  datasource,
  onMoveLabel,
  onDropLabel,
  index,
  type,
  multi,
  datasourceWarningMessage,
  rightNode,
}: MetricDefinitionValueProps) {
  const getSavedMetricByName = (metricName: string) =>
    savedMetrics.find(metric => metric.metric_name === metricName);

  let savedMetric: SavedMetric | undefined;
  if (typeof option === 'string') {
    savedMetric = getSavedMetricByName(option);
  } else if (option && typeof option === 'object' && 'metric_name' in option) {
    savedMetric = option as SavedMetric;
  }

  if (option instanceof AdhocMetric || savedMetric) {
    const adhocMetric =
      option instanceof AdhocMetric ? option : new AdhocMetric({});

    return (
      <AdhocMetricOption
        onMetricEdit={onMetricEdit}
        onRemoveMetric={onRemoveMetric}
        columns={columns}
        savedMetricsOptions={savedMetricsOptions}
        datasource={datasource}
        adhocMetric={adhocMetric}
        onMoveLabel={onMoveLabel}
        onDropLabel={onDropLabel}
        index={index}
        savedMetric={savedMetric ?? ({} as SavedMetric)}
        type={type}
        multi={multi}
        datasourceWarningMessage={datasourceWarningMessage}
        rightNode={rightNode}
      />
    );
  }
  return null;
}
