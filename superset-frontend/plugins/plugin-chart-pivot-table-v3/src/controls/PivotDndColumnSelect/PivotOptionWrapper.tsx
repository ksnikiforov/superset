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
import { useRef } from 'react';
import {
  useDrag,
  useDrop,
  DropTargetMonitor,
  DragSourceMonitor,
} from 'react-dnd';
import { DragContainer } from 'src/explore/components/controls/OptionControls';
import {
  OptionProps,
  OptionItemInterface,
} from 'src/explore/components/controls/DndColumnSelectControl/types';
import { Tooltip } from '@superset-ui/core/components';
import { StyledColumnOption } from 'src/explore/components/optionRenderers';
import { styled, isAdhocColumn } from '@superset-ui/core';
import { ColumnMeta } from '@superset-ui/chart-controls';
import Option from 'src/explore/components/controls/DndColumnSelectControl/Option';

export const OptionLabel = styled.div`
  width: 100%;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
`;

type PivotOptionProps = OptionProps & {
  type: string;
  onShiftOptions: (dragIndex: number, hoverIndex: number) => void;
  listId?: string;
  onHoverIndex?: (index: number) => void;
  onHoverListId?: (listId?: string) => void;
};

export default function PivotOptionWrapper(props: PivotOptionProps) {
  const {
    index,
    label,
    tooltipTitle,
    column,
    type,
    onShiftOptions,
    onHoverIndex,
    onHoverListId,
    clickClose,
    withCaret,
    isExtra,
    datasourceWarningMessage,
    canDelete = true,
    tooltipOverlay,
    listId,
    itemRef,
    ...rest
  } = props;
  const ref = useRef<HTMLDivElement>(null);
  const labelRef = useRef<HTMLDivElement>(null);

  const [{ isDragging }, drag] = useDrag({
    item: {
      type,
      dragIndex: index,
      sourceId: listId,
      column,
    },
    collect: (monitor: DragSourceMonitor) => ({
      isDragging: monitor.isDragging(),
    }),
  });

  const [, drop] = useDrop({
    accept: type,

    hover: (item: OptionItemInterface, monitor: DropTargetMonitor) => {
      if (!ref.current) {
        return;
      }
      const { dragIndex } = item;
      const hoverIndex = index;
      onHoverIndex?.(hoverIndex);
      onHoverListId?.(listId);

      // Don't replace items with themselves
      if (item.sourceId && listId && item.sourceId !== listId) {
        // Cross-list hover: record position but don't reorder this list.
        onHoverIndex?.(hoverIndex);
        onHoverListId?.(listId);
        return;
      }
      if (dragIndex === hoverIndex) {
        return;
      }
      // Determine rectangle on screen
      const hoverBoundingRect = ref.current?.getBoundingClientRect();
      // Get vertical middle
      const hoverMiddleY =
        (hoverBoundingRect.bottom - hoverBoundingRect.top) / 2;
      // Determine mouse position
      const clientOffset = monitor.getClientOffset();
      // Get pixels to the top
      const hoverClientY = clientOffset
        ? clientOffset.y - hoverBoundingRect.top
        : 0;
      // Only perform the move when the mouse has crossed half of the items height
      // When dragging downwards, only move when the cursor is below 50%
      // When dragging upwards, only move when the cursor is above 50%
      // Dragging downwards
      if (dragIndex < hoverIndex && hoverClientY < hoverMiddleY) {
        return;
      }
      // Dragging upwards
      if (dragIndex > hoverIndex && hoverClientY > hoverMiddleY) {
        return;
      }

      // Time to actually perform the action
      onShiftOptions(dragIndex, hoverIndex);
      // eslint-disable-next-line no-param-reassign
      item.dragIndex = hoverIndex;
    },
  });

  const shouldShowTooltip =
    (!isDragging && tooltipTitle && label && tooltipTitle !== label) ||
    (!isDragging &&
      labelRef &&
      labelRef.current &&
      labelRef.current.scrollWidth > labelRef.current.clientWidth) ||
    (!isDragging && tooltipOverlay);

  const LabelContent = () => {
    if (!shouldShowTooltip) {
      return <span>{label}</span>;
    }
    if (tooltipOverlay) {
      return (
        <Tooltip overlay={tooltipOverlay}>
          <span>{label}</span>
        </Tooltip>
      );
    }
    return (
      <Tooltip title={tooltipTitle || label}>
        <span>{label}</span>
      </Tooltip>
    );
  };

  const ColumnOption = () => {
    const transformedCol =
      column && isAdhocColumn(column)
        ? { verbose_name: column.label, expression: column.sqlExpression }
        : column;
    return (
      <StyledColumnOption
        column={transformedCol as ColumnMeta}
        labelRef={labelRef}
        showType
      />
    );
  };

  const Label = () => {
    if (label) {
      return (
        <OptionLabel ref={labelRef}>
          <LabelContent />
        </OptionLabel>
      );
    }
    if (column) {
      return (
        <OptionLabel>
          <ColumnOption />
        </OptionLabel>
      );
    }
    return null;
  };

  const setRefs = (node: HTMLDivElement | null) => {
    ref.current = node;
  };

  drag(drop(ref));

  return (
    <DragContainer
      ref={ref}
      data-option-index={index}
      data-list-id={listId}
      {...rest}
    >
      <Option
        index={index}
        clickClose={clickClose}
        withCaret={withCaret}
        isExtra={isExtra}
        datasourceWarningMessage={datasourceWarningMessage}
        canDelete={canDelete}
      >
        <Label />
      </Option>
    </DragContainer>
  );
}
