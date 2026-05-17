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
import { type KeyboardEvent, type MouseEvent, useCallback } from 'react';
import {
  type ContextMenuFilters,
  type DataRecordValue,
  type JsonObject,
  type QueryObjectFilterClause,
  getColumnLabel,
} from '@superset-ui/core';
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

  const handleCellClick = useCallback(
    (rowNode: PivotTreeNode, colNode: PivotTreeNode) => {
      if (!emitCrossFilters) {
        return;
      }
      const filters = buildCellFilters({
        rowNode,
        colNode,
        program: pivotProgram,
      });
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

      const contextMenuPayload: ContextMenuFilters = {
        drillToDetail: contextFilters,
        crossFilter: emitCrossFilters
          ? {
              dataMask: {
                extraFormData: { filters: contextFilters },
                filterState: {
                  value: buildFilterStateValues(contextFilters),
                  selectedFilters: buildSelectedFilters(contextFilters),
                },
                ownState: {
                  ...(ownState ?? {}),
                  treeDataSignature,
                },
              },
              isCurrentValueSelected: false,
            }
          : undefined,
      };

      onContextMenu(event.clientX, event.clientY, contextMenuPayload);
    },
    [
      dateFormatters,
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
