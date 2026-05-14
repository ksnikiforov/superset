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
import { type RefObject, useLayoutEffect, useRef, useState } from 'react';
import { type RenderModel } from '../render/renderModel';

export type StickyHeaderState = {
  headerOffset: number;
  headerRowOffsets: number[];
  headerRef: RefObject<HTMLTableSectionElement>;
};

export const useStickyHeaders = ({
  enabled,
  columnHeaderRows,
  width,
}: {
  enabled: boolean;
  columnHeaderRows: RenderModel['columnHeaderRows'];
  width: number;
}): StickyHeaderState => {
  const [headerOffset, setHeaderOffset] = useState(0);
  const [headerRowOffsets, setHeaderRowOffsets] = useState<number[]>([]);
  const headerRef = useRef<HTMLTableSectionElement>(null);

  useLayoutEffect(() => {
    if (!enabled) {
      setHeaderOffset(prev => (prev === 0 ? prev : 0));
      setHeaderRowOffsets(prev => (prev.length === 0 ? prev : []));
      return;
    }
    const rows = Array.from(headerRef.current?.querySelectorAll('tr') ?? []);
    let runningOffset = 0;
    const nextRowOffsets = rows.map(row => {
      const currentOffset = runningOffset;
      runningOffset += row.getBoundingClientRect().height;
      return currentOffset;
    });
    const nextOffset = runningOffset;
    setHeaderOffset(prev => (prev === nextOffset ? prev : nextOffset));
    setHeaderRowOffsets(prev => {
      if (prev.length !== nextRowOffsets.length) {
        return nextRowOffsets;
      }
      const isSame = prev.every((value, idx) => value === nextRowOffsets[idx]);
      return isSame ? prev : nextRowOffsets;
    });
  }, [columnHeaderRows, enabled, width]);

  return {
    headerOffset,
    headerRowOffsets,
    headerRef,
  };
};
