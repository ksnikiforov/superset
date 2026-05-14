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
import { useCallback, useMemo, useRef } from 'react';
import { type PivotAxis } from '../../types';

export const useExpansionInFlight = () => {
  const inFlightExpandedRowsRef = useRef<Map<number, Set<string>>>(new Map());
  const inFlightExpandedColsRef = useRef<Map<number, Set<string>>>(new Map());
  const inFlightExpansionIdRef = useRef(0);

  const collect = useCallback((axis: PivotAxis) => {
    const merged = new Set<string>();
    (axis === 'row'
      ? inFlightExpandedRowsRef.current
      : inFlightExpandedColsRef.current
    ).forEach(keys => keys.forEach(key => merged.add(key)));
    return merged;
  }, []);

  const hasOtherAxisInFlight = useCallback((axis: PivotAxis) => {
    const otherMap =
      axis === 'row'
        ? inFlightExpandedColsRef.current
        : inFlightExpandedRowsRef.current;
    return otherMap.size > 0;
  }, []);

  const track = useCallback(
    (
      axis: PivotAxis,
      resolvedExpanded: Set<string>,
      committedExpanded: Set<string>,
    ) => {
      const inFlightId = inFlightExpansionIdRef.current + 1;
      inFlightExpansionIdRef.current = inFlightId;
      const inFlightMap =
        axis === 'row'
          ? inFlightExpandedRowsRef.current
          : inFlightExpandedColsRef.current;
      const inFlightKeys = new Set(resolvedExpanded);
      committedExpanded.forEach(key => inFlightKeys.delete(key));
      if (inFlightKeys.size > 0) {
        inFlightMap.set(inFlightId, inFlightKeys);
      }
      return {
        clear: () => inFlightMap.delete(inFlightId),
      };
    },
    [],
  );

  const clearAll = useCallback(() => {
    inFlightExpandedRowsRef.current.clear();
    inFlightExpandedColsRef.current.clear();
    inFlightExpansionIdRef.current = 0;
  }, []);

  return useMemo(
    () => ({
      clearAll,
      collect,
      hasOtherAxisInFlight,
      track,
    }),
    [clearAll, collect, hasOtherAxisInFlight, track],
  );
};
