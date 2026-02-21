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
import { ReactNode, useMemo, useRef } from 'react';
import {
  useDrag,
  useDrop,
  DropTargetMonitor,
  DragSourceMonitor,
} from 'react-dnd';
import { Tooltip } from '@superset-ui/core/components';
import {
  type AdhocColumn,
  styled,
  isAdhocColumn,
  t,
  useTheme,
} from '@superset-ui/core';
import { ColumnMeta } from '@superset-ui/chart-controls';
import {
  DragContainer,
  type OptionItemInterface,
  StyledColumnOption,
} from '../../exploreImports';
import PivotOption from './PivotOption';

export const OptionLabel = styled.div`
  width: 100%;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
`;

const PlaceholderBadge = styled.span`
  margin-left: ${({ theme }) => theme.sizeXXS}px;
  padding: 0 6px;
  border-radius: ${({ theme }) => theme.borderRadius}px;
  border: 1px solid ${({ theme }) => theme.colorPrimary};
  background: transparent;
  color: ${({ theme }) => theme.colorPrimary};
  font-size: ${({ theme }) => theme.fontSizeSM}px;
  font-weight: ${({ theme }) => theme.fontWeightStrong};
  text-transform: uppercase;
  letter-spacing: 0.03em;
`;

type PivotOptionWrapperProps = {
  index: number;
  label?: string;
  tooltipTitle?: string;
  column?: ColumnMeta | AdhocColumn;
  clickClose: (index: number) => void;
  withCaret?: boolean;
  isExtra?: boolean;
  datasourceWarningMessage?: string;
  canDelete?: boolean;
  tooltipOverlay?: ReactNode;
  rightNode?: ReactNode;
  type: string;
  onShiftOptions: (dragIndex: number, hoverIndex: number) => void;
  listId?: string;
  onHoverIndex?: (index: number) => void;
  onHoverListId?: (listId?: string) => void;
  isPlaceholder?: boolean;
};

type PivotOptionItem = OptionItemInterface & {
  sourceId?: string;
  column?: ColumnMeta | AdhocColumn;
};

export default function PivotOptionWrapper(props: PivotOptionWrapperProps) {
  const theme = useTheme();
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
    isPlaceholder,
    rightNode,
    ...rest
  } = props;
  const ref = useRef<HTMLDivElement>(null);
  const labelRef = useRef<HTMLDivElement>(null);

  const labelStyles = useMemo(() => {
    if (!isPlaceholder) {
      return undefined;
    }
    return {
      color: theme.colorTextSecondary,
      display: 'inline-flex',
      alignItems: 'center',
      gap: theme.sizeXXS,
      lineHeight: 1.1,
    };
  }, [isPlaceholder, theme]);

  const placeholderTextStyles = useMemo(() => {
    if (!isPlaceholder) {
      return undefined;
    }
    return {
      marginRight: theme.sizeXS,
    };
  }, [isPlaceholder, theme]);

  const [{ isDragging }, drag] = useDrag<
    PivotOptionItem,
    void,
    { isDragging: boolean }
  >({
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

  const [, drop] = useDrop<PivotOptionItem, void, Record<string, never>>({
    accept: type,

    hover: (item, monitor: DropTargetMonitor) => {
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

  drag(drop(ref));

  return (
    <DragContainer
      ref={ref}
      data-option-index={index}
      data-list-id={listId}
      {...rest}
    >
      <PivotOption
        index={index}
        clickClose={clickClose}
        withCaret={withCaret && !isPlaceholder}
        isExtra={isExtra}
        datasourceWarningMessage={datasourceWarningMessage}
        canDelete={isPlaceholder ? false : canDelete}
        rightNode={rightNode}
      >
        <OptionLabel ref={labelRef} style={labelStyles}>
          {isPlaceholder ? (
            <>
              <span style={placeholderTextStyles}>{t('Σ Values')}</span>
              <PlaceholderBadge>{t('Fixed')}</PlaceholderBadge>
            </>
          ) : (
            <Label />
          )}
        </OptionLabel>
      </PivotOption>
    </DragContainer>
  );
}
