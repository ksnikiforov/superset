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
import {
  AdhocColumn,
  tn,
  QueryFormColumn,
  t,
  isAdhocColumn,
} from '@superset-ui/core';
import { ColumnMeta, isColumnMeta } from '@superset-ui/chart-controls';
import { isEmpty } from 'lodash';
import { useDispatch } from 'react-redux';
import DndSelectLabel from 'src/explore/components/controls/DndColumnSelectControl/DndSelectLabel';
import OptionWrapper from 'src/explore/components/controls/DndColumnSelectControl/OptionWrapper';
import { OptionSelector } from 'src/explore/components/controls/DndColumnSelectControl/utils';
import { DatasourcePanelDndItem } from 'src/explore/components/DatasourcePanel/types';
import { DndItemType } from 'src/explore/components/DndItemType';
import { setControlValue as setControlValueAction } from 'src/explore/actions/exploreActions';
import ColumnSelectPopoverTrigger from './ColumnSelectPopoverTrigger';
import { DndControlProps } from './types';

const METRICS_PLACEHOLDER = '__MEASURES__';

export type DndColumnSelectProps = DndControlProps<QueryFormColumn> & {
  options: ColumnMeta[];
  isTemporal?: boolean;
  disabledTabs?: Set<string>;
  dragTypeOverride?: string;
  listId?: string;
  pivotPlacement?: {
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
    ) => { rows: QueryFormColumn[]; cols: QueryFormColumn[] };
    setControlValue?: (name: string, value: any, errors?: any[]) => void;
  };
};

function DndColumnSelect(props: DndColumnSelectProps) {
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

  const setLastHoverIndex = useCallback((idx: number) => {
    lastHoverRef.current = { ...lastHoverRef.current, index: idx, listId };
  }, [listId]);

  const setLastHoverList = useCallback(
    (hoverListId?: string) => {
      lastHoverRef.current = {
        ...lastHoverRef.current,
        listId: hoverListId,
      };
    },
    [],
  );

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
        // When moving between axes, treat dimensions as a single set: remove any
        // non-metric placeholder values from the opposite axis to avoid copies.
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
        setControl(
          pivotPlacement.controlNames.rows,
          resolved.rows,
          [],
        );
        setControl(
          pivotPlacement.controlNames.cols,
          resolved.cols,
          [],
        );
        lastHoverRef.current = { index: null, listId: undefined };
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
      lastHoverRef.current = { index: null, listId: undefined };
    },
    [dispatch, onChange, pivotPlacement, toArray],
  );

  const onDrop = useCallback(
    (item: DatasourcePanelDndItem | any) => {
      const column = (item as any)?.value ?? (item as any)?.column;
      if (!column) {
        return;
      }
      const columnName =
        (column as ColumnMeta).column_name ||
        (typeof column === 'string' ? column : undefined);
      const columnValue = columnName || column;
      if (!optionSelector.multi && !isEmpty(optionSelector.values)) {
        optionSelector.replace(0, columnValue);
        applyChange(optionSelector.getValues());
        lastHoverRef.current = { index: null, listId: undefined };
        return;
      }
      const insertAt =
        lastHoverRef.current.index !== null
          ? lastHoverRef.current.index
          : optionSelector.values.length;
      if ((window as any).__PIVOT_V3_DEBUG_PLACEMENT) {
        // eslint-disable-next-line no-console
        console.log('[pivot-v3] DnD drop details', {
          listId,
          lastHover: lastHoverRef.current,
          insertAt,
          values: optionSelector.getValues(),
        });
      }
      if (!optionSelector.has(columnValue)) {
        // Insert relative to the current list, matching Superset's optionSelector helpers.
        const currentValues = optionSelector.getValues();
        const baseValues = Array.isArray(currentValues)
          ? [...currentValues]
          : currentValues != null
          ? [currentValues]
          : [];
        const clampedIndex = Math.max(0, Math.min(insertAt, baseValues.length));
        baseValues.splice(clampedIndex, 0, columnValue as QueryFormColumn);
        applyChange(baseValues);
      } else {
        applyChange(optionSelector.getValues());
      }
      lastHoverRef.current = { index: null, listId: undefined };
    },
    [applyChange, optionSelector, listId],
  );

  const canDrop = useCallback(
    (item: DatasourcePanelDndItem | any) => {
      const value = (item as any)?.value ?? (item as any)?.column;
      const columnName = (value as ColumnMeta)?.column_name;
      // Allow drop if it exists in options OR it's already in the list (reorder) or we have no options map match.
      if (columnName && columnName in optionSelector.options) {
        return !optionSelector.has(columnName);
      }
      // For adhoc/string values, allow unless it's a duplicate
      if (typeof value === 'string') {
        return !optionSelector.has(value);
      }
      return true;
    },
    [optionSelector],
  );

  const onClickClose = useCallback(
    (index: number) => {
      optionSelector.del(index);
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
        const datasourceWarningMessage =
          isAdhocColumn(column) && column.datasourceWarning
            ? t('This column might be incompatible with current dataset')
            : undefined;
        const withCaret = isAdhocColumn(column) || !column.error_text;

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
            <OptionWrapper
              key={idx}
              index={idx}
              clickClose={canDelete ? onClickClose : undefined}
              onShiftOptions={onShiftOptions}
              onHoverIndex={setLastHoverIndex}
              onHoverListId={setLastHoverList}
              type={dragTypeOverride || `${DndItemType.ColumnOption}_${name}_${label}`}
              listId={listId || name}
              canDelete={canDelete}
              column={column}
              datasourceWarningMessage={datasourceWarningMessage}
              withCaret={withCaret}
            />
          </ColumnSelectPopoverTrigger>
        );
      }),
    [
      canDelete,
      isTemporal,
      label,
      name,
      onChange,
      onClickClose,
      onShiftOptions,
      optionSelector,
      options,
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

  return (
    <div>
      <DndSelectLabel
        onDrop={onDrop}
        canDrop={canDrop}
        valuesRenderer={valuesRenderer}
        accept={[DndItemType.Column, dragTypeOverride || DndItemType.Column]}
        displayGhostButton={multi || optionSelector.values.length === 0}
        ghostButtonText={labelGhostButtonText}
        onClickGhostButton={openPopover}
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

export { DndColumnSelect };
