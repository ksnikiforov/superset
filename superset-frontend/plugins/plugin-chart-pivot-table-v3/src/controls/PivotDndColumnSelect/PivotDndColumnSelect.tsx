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
import { useCallback, useMemo, useRef, useState } from 'react';
import { DropTargetMonitor } from 'react-dnd';
import { useDispatch } from 'react-redux';
import {
  AdhocColumn,
  tn,
  QueryFormColumn,
  t,
  isAdhocColumn,
} from '@superset-ui/core';
import { ColumnMeta, isColumnMeta } from '@superset-ui/chart-controls';
import { isEmpty } from 'lodash';
import { setControlValue as setControlValueAction } from 'src/explore/actions/exploreActions';
import ColumnSelectPopoverTrigger from 'src/explore/components/controls/DndColumnSelectControl/ColumnSelectPopoverTrigger';
import { DndControlProps } from 'src/explore/components/controls/DndColumnSelectControl/types';
import { DatasourcePanelDndItem } from 'src/explore/components/DatasourcePanel/types';
import { DndItemType } from 'src/explore/components/DndItemType';
import { METRICS_PLACEHOLDER } from '../../utils';
import PivotOptionWrapper from './PivotOptionWrapper';
import PivotDndSelectLabel from './PivotSelectLabel';
import { OptionSelector } from './optionSelector';

const DEFAULT_DRAG_TYPE = 'pivot_v3_dnd';

export type PivotPlacement = {
  axis: 'rows' | 'cols';
  rows: QueryFormColumn[];
  cols: QueryFormColumn[];
  hasMetrics: boolean;
  preferredAxis?: any;
  controlNames?: { rows: string; cols: string };
  resolve?: (
    rows: QueryFormColumn[],
    cols: QueryFormColumn[],
    options: { hasMetrics: boolean; preferredAxis?: any; lastMoved?: 'row' | 'col' },
  ) => { rows: QueryFormColumn[]; cols: QueryFormColumn[]; layout?: any };
  setControlValue?: (name: string, value: any, errors?: any[]) => void;
};

export type PivotDndColumnSelectProps = DndControlProps<QueryFormColumn> & {
  options: ColumnMeta[];
  isTemporal?: boolean;
  disabledTabs?: Set<string>;
  dragTypeOverride?: string;
  listId?: string;
  pivotPlacement?: PivotPlacement;
};

function PivotDndColumnSelect(props: PivotDndColumnSelectProps) {
  const dispatch = useDispatch();
  const {
    value,
    options,
    multi = true,
    onChange,
    canDelete = true,
    ghostButtonText,
    name,
    label,
    isTemporal,
    disabledTabs,
    dragTypeOverride,
    listId,
    pivotPlacement,
  } = props;
  const [newColumnPopoverVisible, setNewColumnPopoverVisible] = useState(false);
  const lastHoverRef = useRef<{ index: number | null; listId?: string }>({
    index: null,
    listId: undefined,
  });
  const containerRef = useRef<HTMLDivElement>(null);
  const dragType = dragTypeOverride || DEFAULT_DRAG_TYPE;
  const currentListId = listId || name;

  const optionSelector = useMemo(() => {
    const optionsMap = Object.fromEntries(
      options.map(option => [option.column_name, option]),
    );

    return new OptionSelector(optionsMap, multi, value);
  }, [multi, options, value]);

  const toArray = useCallback(
    (val: QueryFormColumn[] | QueryFormColumn | null | undefined) =>
      Array.isArray(val) ? val : val == null ? [] : [val],
    [],
  );

  const resetHover = useCallback(() => {
    lastHoverRef.current = { index: null, listId: undefined };
  }, []);

  const applyChange = useCallback(
    (nextValue: QueryFormColumn[] | QueryFormColumn | null | undefined) => {
      const debugOn = (window as any).__PIVOT_V3_DEBUG_PLACEMENT;
      if (
        pivotPlacement?.resolve &&
        pivotPlacement.controlNames?.rows &&
        pivotPlacement.controlNames?.cols
      ) {
        let rowsNext =
          pivotPlacement.axis === 'rows'
            ? toArray(nextValue)
            : toArray(pivotPlacement.rows);
        let colsNext =
          pivotPlacement.axis === 'cols'
            ? toArray(nextValue)
            : toArray(pivotPlacement.cols);
        if (pivotPlacement.axis === 'rows') {
          colsNext = colsNext.filter(
            val => val === METRICS_PLACEHOLDER || !rowsNext.includes(val),
          );
        } else {
          rowsNext = rowsNext.filter(
            val => val === METRICS_PLACEHOLDER || !colsNext.includes(val),
          );
        }
        const resolved = pivotPlacement.resolve(rowsNext, colsNext, {
          hasMetrics: pivotPlacement.hasMetrics,
          preferredAxis: pivotPlacement.preferredAxis,
          lastMoved: pivotPlacement.axis === 'rows' ? 'row' : 'col',
        });
        if (debugOn) {
          // eslint-disable-next-line no-console
          console.log('[pivot-v3] DnD applyChange', {
            axis: pivotPlacement.axis,
            rowsNext,
            colsNext,
            resolved,
          });
        }
        const setControl =
          pivotPlacement.setControlValue ||
          ((name: string, val: any) =>
            dispatch(setControlValueAction(name, val, [])));
        // Defer control updates to avoid unmounting drop targets mid-drag,
        // which can trigger react-dnd's "Expected to find a valid target".
        requestAnimationFrame(() => {
          setControl(pivotPlacement.controlNames.rows, resolved.rows, []);
          setControl(pivotPlacement.controlNames.cols, resolved.cols, []);
        });
        resetHover();
        return;
      }
      if (debugOn) {
        // eslint-disable-next-line no-console
        console.log('[pivot-v3] DnD fallback applyChange', {
          axis: pivotPlacement?.axis,
          pivotPlacementPresent: !!pivotPlacement,
          nextValue,
        });
      }
      onChange(nextValue);
      resetHover();
    },
    [dispatch, onChange, pivotPlacement, resetHover, toArray],
  );

  const setLastHoverIndex = useCallback(
    (idx: number) => {
      lastHoverRef.current = {
        ...lastHoverRef.current,
        index: idx,
        listId: currentListId,
      };
    },
    [currentListId],
  );

  const setLastHoverList = useCallback((hoverListId?: string) => {
    lastHoverRef.current = {
      ...lastHoverRef.current,
      listId: hoverListId,
    };
  }, []);

  const computeInsertIndex = useCallback(
    (monitor?: DropTargetMonitor) => {
      const clientOffset = monitor?.getClientOffset();
      if (clientOffset && containerRef.current) {
        const items = Array.from(
          containerRef.current.querySelectorAll<HTMLElement>(
            '[data-option-index]',
          ),
        );
        for (let idx = 0; idx < items.length; idx += 1) {
          const rect = items[idx].getBoundingClientRect();
          if (clientOffset.y < rect.top + rect.height / 2) {
            return idx;
          }
        }
        if (items.length > 0) {
          return items.length;
        }
      }
      if (
        lastHoverRef.current.listId === currentListId &&
        lastHoverRef.current.index !== null
      ) {
        return lastHoverRef.current.index;
      }
      return optionSelector.values.length;
    },
    [currentListId, optionSelector.values.length],
  );

  const onDrop = useCallback(
    (item: DatasourcePanelDndItem | any, monitor?: DropTargetMonitor) => {
      const column = (item as any)?.value ?? (item as any)?.column;
      if (!column) {
        return;
      }
      const columnName =
        (column as ColumnMeta).column_name ||
        (typeof column === 'string' ? column : undefined);
      const columnValue = columnName || column;
      if (!optionSelector.multi && !isEmpty(optionSelector.values)) {
        optionSelector.replace(0, columnValue as QueryFormColumn);
        applyChange(optionSelector.getValues());
        resetHover();
        return;
      }
      const insertAt = computeInsertIndex(monitor);
      if ((window as any).__PIVOT_V3_DEBUG_PLACEMENT) {
        // eslint-disable-next-line no-console
        console.log('[pivot-v3] DnD drop details', {
          listId: currentListId,
          lastHover: lastHoverRef.current,
          insertAt,
          values: optionSelector.getValues(),
        });
      }
      if (!optionSelector.has(columnValue)) {
        const baseValues = toArray(optionSelector.getValues());
        const clampedIndex = Math.max(
          0,
          Math.min(insertAt, baseValues.length),
        );
        baseValues.splice(clampedIndex, 0, columnValue as QueryFormColumn);
        applyChange(baseValues);
      } else {
        applyChange(optionSelector.getValues());
      }
      resetHover();
    },
    [
      applyChange,
      computeInsertIndex,
      currentListId,
      optionSelector,
      resetHover,
      toArray,
    ],
  );

  const canDrop = useCallback(
    (item: DatasourcePanelDndItem | any) => {
      const value = (item as any)?.value ?? (item as any)?.column;
      const columnName = (value as ColumnMeta)?.column_name;
      if (columnName && columnName in optionSelector.options) {
        return !optionSelector.has(columnName);
      }
      if (typeof value === 'string') {
        return !optionSelector.has(value);
      }
      return true;
    },
    [optionSelector],
  );

  const onClickClose = useCallback(
    (indexToDelete: number) => {
      optionSelector.del(indexToDelete);
      applyChange(optionSelector.getValues());
    },
    [applyChange, optionSelector],
  );

  const onShiftOptions = useCallback(
    (dragIndex: number, hoverIndex: number) => {
      optionSelector.swap(dragIndex, hoverIndex);
      applyChange(optionSelector.getValues());
    },
    [applyChange, optionSelector],
  );

  const valuesRenderer = useCallback(
    () =>
      optionSelector.values.map((column, idx) => {
        const isPlaceholder =
          column === METRICS_PLACEHOLDER ||
          (isColumnMeta(column) &&
            column.column_name === METRICS_PLACEHOLDER);
        const datasourceWarningMessage =
          isAdhocColumn(column) && column.datasourceWarning
            ? t('This column might be incompatible with current dataset')
            : undefined;
        const withCaret =
          !isPlaceholder && (isAdhocColumn(column) || !column.error_text);
        const optionNode = (
          <PivotOptionWrapper
            key={getOptionKey(column, idx)}
            index={idx}
            clickClose={!isPlaceholder && canDelete ? onClickClose : undefined}
            onShiftOptions={onShiftOptions}
            onHoverIndex={setLastHoverIndex}
            onHoverListId={setLastHoverList}
            type={dragType}
            listId={currentListId}
            canDelete={!isPlaceholder && canDelete}
            column={column}
            datasourceWarningMessage={datasourceWarningMessage}
            withCaret={withCaret}
            isPlaceholder={isPlaceholder}
            tooltipOverlay={
              isPlaceholder
                ? t(
                    'Values placeholder for metrics placement; it cannot be removed.',
                  )
                : undefined
            }
          />
        );

        if (isPlaceholder) {
          return optionNode;
        }

        return (
          <ColumnSelectPopoverTrigger
            key={idx}
            columns={options}
            onColumnEdit={newColumn => {
              if (isColumnMeta(newColumn)) {
                optionSelector.replace(idx, newColumn.column_name);
              } else {
                optionSelector.replace(idx, newColumn as AdhocColumn);
              }
              applyChange(optionSelector.getValues());
            }}
            editedColumn={column}
            isTemporal={isTemporal}
            disabledTabs={disabledTabs}
          >
            {optionNode}
          </ColumnSelectPopoverTrigger>
        );
      }),
    [
      applyChange,
      canDelete,
      currentListId,
      disabledTabs,
      dragType,
      isTemporal,
      onClickClose,
      onShiftOptions,
      optionSelector,
      options,
      setLastHoverIndex,
      setLastHoverList,
    ],
  );

  const addNewColumnWithPopover = useCallback(
    (newColumn: ColumnMeta | AdhocColumn) => {
      if (isColumnMeta(newColumn)) {
        optionSelector.add(newColumn.column_name);
      } else {
        optionSelector.add(newColumn as AdhocColumn);
      }
      applyChange(optionSelector.getValues());
    },
    [applyChange, optionSelector],
  );

  const togglePopover = useCallback((visible: boolean) => {
    setNewColumnPopoverVisible(visible);
  }, []);

  const closePopover = useCallback(() => {
    togglePopover(false);
  }, [togglePopover]);

  const openPopover = useCallback(() => {
    togglePopover(true);
  }, [togglePopover]);

  const labelGhostButtonText = useMemo(
    () =>
      ghostButtonText ??
      tn(
        'Drop a column here or click',
        'Drop columns here or click',
        multi ? 2 : 1,
      ),
    [ghostButtonText, multi],
  );

  const getOptionKey = useCallback(
    (column: QueryFormColumn | ColumnMeta | AdhocColumn | string, idx: number) => {
      if (
        column === METRICS_PLACEHOLDER ||
        (isColumnMeta(column) && column.column_name === METRICS_PLACEHOLDER)
      ) {
        return `${currentListId}-placeholder`;
      }
      if (isColumnMeta(column)) {
        return `${currentListId}-col-${column.column_name}`;
      }
      if (isAdhocColumn(column)) {
        return `${currentListId}-adhoc-${column.label || column.sqlExpression || idx}`;
      }
      if (typeof column === 'string') {
        return `${currentListId}-str-${column}`;
      }
      return `${currentListId}-idx-${idx}`;
    },
    [currentListId],
  );

  return (
    <div>
      <PivotDndSelectLabel
        onDrop={onDrop}
        canDrop={canDrop}
        valuesRenderer={valuesRenderer}
        accept={[DndItemType.Column, dragType]}
        displayGhostButton={multi || optionSelector.values.length === 0}
        ghostButtonText={labelGhostButtonText}
        onClickGhostButton={openPopover}
        containerRef={containerRef}
        {...props}
      />
      <ColumnSelectPopoverTrigger
        columns={options}
        onColumnEdit={addNewColumnWithPopover}
        isControlledComponent
        togglePopover={togglePopover}
        closePopover={closePopover}
        visible={newColumnPopoverVisible}
        isTemporal={isTemporal}
        disabledTabs={disabledTabs}
      >
        <div />
      </ColumnSelectPopoverTrigger>
    </div>
  );
}

export default PivotDndColumnSelect;
