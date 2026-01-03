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
import { ReactNode, useCallback } from 'react';
import { Metric } from '@superset-ui/core';
import { DndItemType } from 'src/explore/components/DndItemType';
import AdhocMetric from 'src/explore/components/controls/MetricControl/AdhocMetric';
import AdhocMetricPopoverTrigger from 'src/explore/components/controls/MetricControl/AdhocMetricPopoverTrigger';
import { savedMetricType } from 'src/explore/components/controls/MetricControl/types';
import { ColumnMeta } from '@superset-ui/chart-controls';
import OptionControlLabel from './OptionControlLabel';

type SavedMetric = savedMetricType & { error_text?: string };

type AdhocMetricOptionProps = {
  adhocMetric: AdhocMetric;
  onMetricEdit: (newMetric: Metric, oldMetric: Metric) => void;
  onRemoveMetric?: (index: number) => void;
  columns: ColumnMeta[];
  savedMetricsOptions: savedMetricType[];
  savedMetric: SavedMetric;
  datasource?: Record<string, unknown>;
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

  return (
    <AdhocMetricPopoverTrigger
      adhocMetric={adhocMetric}
      onMetricEdit={onMetricEdit}
      columns={columns}
      savedMetricsOptions={savedMetricsOptions}
      savedMetric={savedMetric}
      datasource={datasource}
    >
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
    </AdhocMetricPopoverTrigger>
  );
};

export default AdhocMetricOption;
