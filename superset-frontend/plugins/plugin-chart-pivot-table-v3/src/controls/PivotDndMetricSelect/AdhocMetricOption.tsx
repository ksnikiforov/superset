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
import { type ComponentProps, ReactNode, useCallback, useMemo } from 'react';
import { Metric } from '@superset-ui/core';
import { ColumnMeta } from '@superset-ui/chart-controls';
import {
  AdhocMetric,
  AdhocMetricPopoverTrigger,
  DndItemType,
  type savedMetricType,
} from '../../exploreImports';
import OptionControlLabel from './OptionControlLabel';

type SavedMetric = savedMetricType & { error_text?: string };
type AdhocMetricPopoverDatasource =
  ComponentProps<typeof AdhocMetricPopoverTrigger>['datasource'];
type AdhocMetricPopoverColumns =
  ComponentProps<typeof AdhocMetricPopoverTrigger>['columns'];

type AdhocMetricOptionProps = {
  adhocMetric: AdhocMetric;
  onMetricEdit: (newMetric: Metric, oldMetric: Metric) => void;
  onRemoveMetric?: (index: number) => void;
  columns: ColumnMeta[];
  savedMetricsOptions: savedMetricType[];
  savedMetric: SavedMetric;
  datasource?: AdhocMetricPopoverDatasource;
  onMoveLabel: (dragIndex: number, hoverIndex: number) => void;
  onDropLabel: () => void;
  index: number;
  type?: string;
  multi?: boolean;
  datasourceWarningMessage?: string;
  rightNode?: ReactNode;
};

const AdhocMetricOption = ({
  adhocMetric,
  onMetricEdit,
  onRemoveMetric,
  columns,
  savedMetricsOptions,
  savedMetric,
  datasource,
  onMoveLabel,
  onDropLabel,
  index,
  type,
  multi,
  datasourceWarningMessage,
  rightNode,
}: AdhocMetricOptionProps) => {
  const popoverColumns = useMemo<AdhocMetricPopoverColumns>(
    () =>
      columns.map(column => ({
        column_name: column.column_name,
        type: column.type ?? '',
      })),
    [columns],
  );
  const handleRemoveMetric = useCallback(
    (event?: React.MouseEvent) => {
      event?.stopPropagation();
      if (onRemoveMetric) {
        onRemoveMetric(index);
      }
    },
    [index, onRemoveMetric],
  );
  const withCaret = !savedMetric?.error_text;

  const label = (
    <OptionControlLabel
      savedMetric={savedMetric}
      adhocMetric={adhocMetric}
      label={adhocMetric.label}
      onRemove={handleRemoveMetric}
      onMoveLabel={onMoveLabel}
      onDropLabel={onDropLabel}
      index={index}
      type={type ?? DndItemType.AdhocMetricOption}
      withCaret={withCaret}
      isFunction
      multi={multi}
      datasourceWarningMessage={datasourceWarningMessage}
      rightNode={rightNode}
    />
  );

  if (!datasource) {
    return label;
  }

  return (
    <AdhocMetricPopoverTrigger
      adhocMetric={adhocMetric}
      onMetricEdit={onMetricEdit}
      columns={popoverColumns}
      savedMetricsOptions={savedMetricsOptions}
      savedMetric={savedMetric}
      datasource={datasource}
    >
      {label}
    </AdhocMetricPopoverTrigger>
  );
};

export default AdhocMetricOption;
