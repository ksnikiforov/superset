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
  type PivotResultCell,
  type PivotTreeData,
  type PivotTreeNode,
} from '../../../src/types';

export const mergeTrees = (
  left?: PivotTreeData,
  right?: PivotTreeData,
): PivotTreeData => {
  const mergeNodeMaps = (
    target?: Record<string, PivotTreeNode>,
    source?: Record<string, PivotTreeNode>,
  ) => {
    const result: Record<string, PivotTreeNode> = { ...(target || {}) };
    Object.entries(source || {}).forEach(([key, node]) => {
      const existing = result[key];
      if (!existing) {
        result[key] = node;
        return;
      }
      const mergedValues =
        node.values && Object.keys(node.values).length > 0
          ? { ...(existing.values || {}), ...node.values }
          : existing.values;
      result[key] = {
        ...existing,
        ...node,
        ...(mergedValues ? { values: mergedValues } : {}),
      };
    });
    return result;
  };

  const mergeCells = (
    target?: Record<string, PivotResultCell>,
    source?: Record<string, PivotResultCell>,
  ) => {
    const result = { ...(target ?? {}) } as Record<string, PivotResultCell>;
    Object.entries(source || {}).forEach(([key, cell]) => {
      const existing = result[key];
      if (!existing) {
        result[key] = cell;
        return;
      }
      const mergedValues =
        cell.values && Object.keys(cell.values).length > 0
          ? { ...(existing.values || {}), ...cell.values }
          : existing.values;
      result[key] = {
        ...existing,
        ...cell,
        ...(mergedValues ? { values: mergedValues } : {}),
        isSubtotal: cell.isSubtotal ?? existing.isSubtotal,
      };
    });
    return result;
  };

  return {
    rows: mergeNodeMaps(left?.rows, right?.rows),
    cols: mergeNodeMaps(left?.cols, right?.cols),
    cells: mergeCells(left?.cells, right?.cells),
  };
};
