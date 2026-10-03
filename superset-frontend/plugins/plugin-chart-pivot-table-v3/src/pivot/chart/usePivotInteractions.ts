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
import {
  type KeyboardEvent,
  type MouseEvent,
  useCallback,
  useRef,
} from 'react';
import {
  type ContextMenuFilters,
  type DataRecordValue,
  type JsonObject,
  type QueryObjectFilterClause,
  getColumnLabel,
} from '@superset-ui/core';
import { isEqual } from 'lodash';
import { type PivotTableProps, type PivotTreeNode } from '../../types';
import { buildCellFilters, buildContextMenuFilters } from '../filters';
import { type PivotLayoutResult } from './usePivotLayout';

export type PivotInteractionsResult = {
  handleCellClick: (rowNode: PivotTreeNode, colNode: PivotTreeNode) => void;
  handleCellKeyDown: (
    event: KeyboardEvent<HTMLTableCellElement>,
    rowNode: PivotTreeNode,
    colNode: PivotTreeNode,
  ) => void;
  handleCellContextMenu: (
    event: MouseEvent<HTMLTableCellElement>,
    rowNode: PivotTreeNode,
    colNode: PivotTreeNode,
  ) => void;
};

const buildSelectedFilters = (
  filters: QueryObjectFilterClause[],
): Record<string, DataRecordValue[]> => {
  const selected: Record<string, DataRecordValue[]> = {};
  filters.forEach(filter => {
    const key = getColumnLabel(filter.col);
    const rawValue = 'val' in filter ? filter.val : null;
    const values = Array.isArray(rawValue) ? rawValue : [rawValue];
    selected[key] = values;
  });
  return selected;
};

const buildFilterStateValues = (filters: QueryObjectFilterClause[]) =>
  filters.map(filter => ('val' in filter ? filter.val : null));

export const usePivotInteractions = ({
  emitCrossFilters,
  selectedFilters = {},
  setDataMask,
  mergeOwnState,
  treeDataSignature,
  layout,
  onContextMenu,
  ownState,
  dateFormatters,
  timeGrainSqla,
}: {
  emitCrossFilters?: PivotTableProps['emitCrossFilters'];
  selectedFilters?: PivotTableProps['selectedFilters'];
  setDataMask: PivotTableProps['setDataMask'];
  mergeOwnState: (partial: JsonObject) => JsonObject;
  treeDataSignature: string;
  layout: PivotLayoutResult;
  onContextMenu?: PivotTableProps['onContextMenu'];
  ownState?: PivotTableProps['ownState'];
  dateFormatters: PivotTableProps['formData']['dateFormatters'];
  timeGrainSqla?: PivotTableProps['formData']['timeGrainSqla'];
}): PivotInteractionsResult => {
  const { pivotProgram } = layout.layout;
  const selectionRef = useRef({
    incoming: selectedFilters,
    selected: selectedFilters,
  });
  if (!isEqual(selectionRef.current.incoming, selectedFilters)) {
    selectionRef.current = {
      incoming: selectedFilters,
      selected: selectedFilters,
    };
  }
  const resolveSelection = useCallback((filters: QueryObjectFilterClause[]) => {
    const selected = buildSelectedFilters(filters);
    const isSelected = isEqual(selectionRef.current.selected, selected);
    return {
      isSelected,
      filters: isSelected ? [] : filters,
      selected: isSelected ? {} : selected,
    };
  }, []);

  const handleCellClick = useCallback(
    (rowNode: PivotTreeNode, colNode: PivotTreeNode) => {
      if (!emitCrossFilters) {
        return;
      }
      const selection = resolveSelection(
        buildCellFilters({
          rowNode,
          colNode,
          program: pivotProgram,
        }),
      );
      selectionRef.current.selected = selection.selected;
      const { filters } = selection;
      setDataMask({
        extraFormData: {
          filters,
        },
        filterState: {
          value: buildFilterStateValues(filters),
          selectedFilters: buildSelectedFilters(filters),
        },
        ownState: {
          ...mergeOwnState({
            treeDataSignature,
          }),
        },
      });
    },
    [
      emitCrossFilters,
      resolveSelection,
      mergeOwnState,
      pivotProgram,
      setDataMask,
      treeDataSignature,
    ],
  );

  const handleCellKeyDown = useCallback(
    (
      event: KeyboardEvent<HTMLTableCellElement>,
      rowNode: PivotTreeNode,
      colNode: PivotTreeNode,
    ) => {
      if (event.key !== 'Enter' && event.key !== ' ') {
        return;
      }
      event.preventDefault();
      handleCellClick(rowNode, colNode);
    },
    [handleCellClick],
  );

  const handleCellContextMenu = useCallback(
    (
      event: MouseEvent<HTMLTableCellElement>,
      rowNode: PivotTreeNode,
      colNode: PivotTreeNode,
    ) => {
      if (!onContextMenu) {
        return;
      }
      event.preventDefault();
      const contextFilters = buildContextMenuFilters({
        rowNode,
        colNode,
        program: pivotProgram,
        dateFormatters,
        timeGrainSqla,
      });

      const selection = resolveSelection(contextFilters);
      const contextMenuPayload: ContextMenuFilters = {
        drillToDetail: contextFilters,
        crossFilter: emitCrossFilters
          ? {
              dataMask: {
                extraFormData: { filters: selection.filters },
                filterState: {
                  value: buildFilterStateValues(selection.filters),
                  selectedFilters: selection.selected,
                },
                ownState: {
                  ...ownState,
                  treeDataSignature,
                },
              },
              isCurrentValueSelected: selection.isSelected,
            }
          : undefined,
      };

      onContextMenu(event.clientX, event.clientY, contextMenuPayload);
    },
    [
      dateFormatters,
      resolveSelection,
      emitCrossFilters,
      onContextMenu,
      ownState,
      pivotProgram,
      treeDataSignature,
      timeGrainSqla,
    ],
  );

  return {
    handleCellClick,
    handleCellKeyDown,
    handleCellContextMenu,
  };
};
