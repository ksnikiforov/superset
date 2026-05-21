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
import { memo, useCallback, useEffect, useRef, type ReactNode } from 'react';
import { t } from '@apache-superset/core/translation';
import { styled } from '@apache-superset/core/theme';
import { Icons } from '@superset-ui/core/components/Icons';
import { useDrag, useDragLayer, useDrop } from 'react-dnd';
import { getEmptyImage } from 'react-dnd-html5-backend';
import { type PivotAxis } from '../../types';
import {
  INTERACTION_DIMENSION_DND_TYPE,
  INTERACTION_VALUE_DND_TYPE,
  type InteractionChipItem,
} from '../layout/interactionDrag';

export const INTERACTION_PANEL_WIDTH = 230;
export const INTERACTION_TOP_CHIPS_HEIGHT = 36;
export const INTERACTION_SIDE_CHIPS_WIDTH = 24;

const InteractionLayout = styled.div`
  display: flex;
  height: 100%;
  width: 100%;
`;

const InteractionPanelWrap = styled.div`
  width: ${INTERACTION_PANEL_WIDTH}px;
  flex: 0 0 ${INTERACTION_PANEL_WIDTH}px;
  padding: ${({ theme }) =>
    `${theme.sizeXXS}px ${theme.sizeSM}px ${theme.sizeXXS}px ${theme.sizeXXS}px`};
  border-right: 1px solid ${({ theme }) => theme.colorBorderSecondary};
  height: 100%;
  overflow: hidden;
  scrollbar-width: none;
  -ms-overflow-style: none;

  &::-webkit-scrollbar {
    width: 0;
    height: 0;
  }
`;

const InteractionTableWrap = styled.div`
  flex: 1 1 auto;
  min-width: 0;
  display: flex;
  flex-direction: column;
  height: 100%;
`;

const ChipRow = styled.div`
  display: flex;
  align-items: center;
  gap: ${({ theme }) => theme.sizeXS}px;
  padding: ${({ theme }) => theme.sizeXXS}px ${({ theme }) => theme.sizeSM}px;
  height: ${INTERACTION_TOP_CHIPS_HEIGHT}px;
  border-bottom: 1px solid ${({ theme }) => theme.colorBorderSecondary};
  overflow: hidden;
`;

const ChipColumn = styled.div`
  display: flex;
  flex-direction: column;
  gap: ${({ theme }) => theme.sizeXS}px;
  padding: 0;
  width: ${INTERACTION_SIDE_CHIPS_WIDTH}px;
  border-right: 1px solid ${({ theme }) => theme.colorBorderSecondary};
  overflow: hidden;
  align-items: center;
`;

const Chip = styled.div`
  flex: 0 1 auto;
  min-width: 0;
  max-width: 100%;
  padding: 2px 8px;
  border-radius: 10px;
  background: ${({ theme }) => theme.colorFillSecondary};
  background-clip: padding-box;
  overflow: hidden;
  font-size: 11px;
  display: inline-flex;
  align-items: center;
  gap: ${({ theme }) => theme.sizeXXS}px;
  cursor: grab;
`;

const ValueChip = styled(Chip)`
  background: ${({ theme }) => theme.colorPrimaryBg};
  color: ${({ theme }) => theme.colorPrimaryText};
  border: 1px solid ${({ theme }) => theme.colorPrimaryBorder};
`;

const ChipLabel = styled.span`
  flex: 1 1 auto;
  min-width: 0;
  text-overflow: ellipsis;
  overflow: hidden;
  white-space: nowrap;
`;

const ChipCloseButton = styled.button`
  border: 0;
  background: ${({ theme }) => theme.colorFill};
  padding: 0;
  margin: 0;
  width: 14px;
  height: 14px;
  border-radius: 50%;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  color: ${({ theme }) => theme.colorTextSecondary};
  cursor: pointer;
`;

const VerticalChip = styled(Chip)`
  position: relative;
  flex-direction: column;
  justify-content: flex-start;
  align-items: center;
  padding: 18px 2px 2px;
`;

const VerticalValueChip = styled(ValueChip)`
  flex-direction: column;
  justify-content: center;
  padding: 2px 4px;
`;

const VerticalChipLabel = styled(ChipLabel)`
  writing-mode: vertical-rl;
  text-orientation: mixed;
  transform: rotate(180deg);
  transform-origin: center;
`;

const VerticalChipCloseButton = styled(ChipCloseButton)`
  position: absolute;
  top: 2px;
  left: 50%;
  transform: translateX(-50%);
`;

const DragPreviewWrap = styled.div`
  position: fixed;
  pointer-events: none;
  z-index: 2000;
  top: 0;
  left: 0;
`;

const DragPreviewChip = styled(Chip)`
  box-shadow: ${({ theme }) => theme.boxShadowSecondary};
`;

const DragPreviewValueChip = styled(ValueChip)`
  box-shadow: ${({ theme }) => theme.boxShadowSecondary};
`;

const TableRow = styled.div`
  flex: 1 1 auto;
  min-height: 0;
  display: flex;
`;

const TableArea = styled.div<{ $height: number; $width: number }>`
  position: relative;
  flex: 1 1 auto;
  min-width: 0;
  width: ${({ $width }) => $width}px;
  height: ${({ $height }) => $height}px;
`;

type DimensionDragItem = {
  type: string;
  kind: 'dimension';
  label?: string;
  dimensionKey: string;
  sourceAxis?: PivotAxis;
  sourceChipIndex?: number;
};

type ValueDragItem = {
  type: string;
  kind: 'value';
  label?: string;
  sourceAxis: PivotAxis;
  sourceChipIndex?: number;
};

type DragItem = DimensionDragItem | ValueDragItem;

export type InteractionDropDimension = (
  dimensionKey: string,
  targetAxis: PivotAxis,
  targetChipIndex: number | undefined,
  insertBeforeValue: boolean,
  sourceAxis?: PivotAxis,
  sourceChipIndex?: number,
) => void;

export type InteractionDropValue = (
  targetAxis: PivotAxis,
  targetChipIndex: number | undefined,
  sourceAxis: PivotAxis,
  sourceChipIndex?: number,
) => void;

type InteractionChipProps = {
  axis: PivotAxis;
  chip: InteractionChipItem;
  chipIndex: number;
  vertical?: boolean;
  onRegisterRef?: (node: HTMLDivElement | null) => void;
  onDropDimension: InteractionDropDimension;
  onDropValue: InteractionDropValue;
  onRemove?: (dimensionKey: string) => void;
};

const dimensionDndType =
  INTERACTION_DIMENSION_DND_TYPE || 'pivot-v3-interaction-dimension';
const valueDndType = INTERACTION_VALUE_DND_TYPE || 'pivot-v3-interaction-value';

const InteractionChip = ({
  axis,
  chip,
  chipIndex,
  vertical = false,
  onRegisterRef,
  onDropDimension,
  onDropValue,
  onRemove,
}: InteractionChipProps) => {
  const isValue = chip.kind === 'value';
  const ref = useRef<HTMLDivElement>(null);
  const [{ isDragging }, drag, preview] = useDrag<
    DragItem,
    void,
    { isDragging: boolean }
  >({
    item: isValue
      ? {
          type: valueDndType,
          kind: 'value',
          label: chip.label,
          sourceAxis: axis,
          sourceChipIndex: chipIndex,
        }
      : {
          type: dimensionDndType,
          kind: 'dimension',
          label: chip.label,
          dimensionKey: chip.id,
          sourceAxis: axis,
          sourceChipIndex: chipIndex,
        },
    collect: monitor => ({
      isDragging: monitor.isDragging(),
    }),
  });

  useEffect(() => {
    preview(getEmptyImage(), { captureDraggingState: true });
  }, [preview]);

  const [, drop] = useDrop<DragItem, void, unknown>({
    accept: [dimensionDndType, valueDndType],
    drop: (item, monitor) => {
      const clientOffset = monitor.getClientOffset();
      const rect = ref.current?.getBoundingClientRect();
      const dropRatio = 0.33;
      const isAfter =
        rect && clientOffset
          ? vertical
            ? clientOffset.y > rect.top + rect.height * dropRatio
            : clientOffset.x > rect.left + rect.width * dropRatio
          : false;
      const targetChipIndex = chipIndex + (isAfter ? 1 : 0);
      const insertBeforeValue = isValue && !isAfter;

      if (item.kind === 'dimension') {
        if (item.dimensionKey === chip.id && item.sourceAxis === axis) {
          return;
        }
        onDropDimension(
          item.dimensionKey,
          axis,
          targetChipIndex,
          insertBeforeValue,
          item.sourceAxis,
          item.sourceChipIndex,
        );
        return;
      }
      if (!(isValue && item.sourceAxis === axis && !isAfter)) {
        onDropValue(
          axis,
          targetChipIndex,
          item.sourceAxis,
          item.sourceChipIndex,
        );
      }
    },
  });

  drag(drop(ref));
  useEffect(() => {
    onRegisterRef?.(ref.current);
    return () => {
      onRegisterRef?.(null);
    };
  }, [onRegisterRef]);
  const ChipComponent =
    chip.kind === 'value'
      ? vertical
        ? VerticalValueChip
        : ValueChip
      : vertical
        ? VerticalChip
        : Chip;
  const LabelComponent = vertical ? VerticalChipLabel : ChipLabel;
  const CloseComponent = vertical ? VerticalChipCloseButton : ChipCloseButton;

  return (
    <ChipComponent ref={ref} style={{ opacity: isDragging ? 0.4 : 1 }}>
      <LabelComponent>{chip.label}</LabelComponent>
      {chip.kind === 'dimension' && onRemove ? (
        <CloseComponent
          type="button"
          onClick={event => {
            event.stopPropagation();
            onRemove(chip.id);
          }}
          aria-label={t('Remove dimension')}
        >
          <Icons.CloseOutlined iconSize="xs" iconColor="currentColor" />
        </CloseComponent>
      ) : null}
    </ChipComponent>
  );
};

const PivotDragLayer = memo(() => {
  const dragLayer = useDragLayer(monitor => ({
    item: monitor.getItem() as DragItem | null,
    isDragging: monitor.isDragging(),
    currentOffset: monitor.getClientOffset(),
  }));

  if (
    !dragLayer.isDragging ||
    !dragLayer.item?.label ||
    !dragLayer.currentOffset
  ) {
    return null;
  }

  return (
    <DragPreviewWrap
      style={{
        transform: `translate(${dragLayer.currentOffset.x}px, ${dragLayer.currentOffset.y}px) translate(-50%, -50%)`,
      }}
    >
      {dragLayer.item.kind === 'value' ? (
        <DragPreviewValueChip>
          <ChipLabel>{dragLayer.item.label}</ChipLabel>
        </DragPreviewValueChip>
      ) : (
        <DragPreviewChip>
          <ChipLabel>{dragLayer.item.label}</ChipLabel>
        </DragPreviewChip>
      )}
    </DragPreviewWrap>
  );
});

export type PivotInteractionLayoutProps = {
  height: number;
  panel: ReactNode;
  tableHeight: number;
  tableWidth: number;
  rowChips: InteractionChipItem[];
  colChips: InteractionChipItem[];
  onDropDimension: InteractionDropDimension;
  onDropValue: InteractionDropValue;
  onRemoveDimension: (dimensionKey: string) => void;
  children: ReactNode;
};

export const PivotInteractionLayout = ({
  height,
  panel,
  tableHeight,
  tableWidth,
  rowChips,
  colChips,
  onDropDimension,
  onDropValue,
  onRemoveDimension,
  children,
}: PivotInteractionLayoutProps) => {
  const rowChipRefs = useRef<Array<HTMLDivElement | null>>([]);
  const colChipRefs = useRef<Array<HTMLDivElement | null>>([]);

  const getStripDropIndex = useCallback(
    (axis: PivotAxis, clientOffset: { x: number; y: number } | null) => {
      const chips = axis === 'row' ? rowChips : colChips;
      const refs = axis === 'row' ? rowChipRefs.current : colChipRefs.current;
      const nodes = refs
        .slice(0, chips.length)
        .filter((node): node is HTMLDivElement => node !== null);
      if (!clientOffset || nodes.length === 0) {
        return 0;
      }
      const dropRatio = 0.33;
      for (let index = 0; index < nodes.length; index += 1) {
        const rect = nodes[index].getBoundingClientRect();
        const pivot =
          axis === 'row'
            ? rect.top + rect.height * dropRatio
            : rect.left + rect.width * dropRatio;
        const offset = axis === 'row' ? clientOffset.y : clientOffset.x;
        if (offset < pivot) {
          return index;
        }
      }
      return nodes.length;
    },
    [colChips, rowChips],
  );

  const [, dropOnRowStrip] = useDrop<DragItem, void, unknown>({
    accept: [dimensionDndType, valueDndType],
    drop: (item, monitor) => {
      if (monitor.didDrop()) {
        return;
      }
      const targetChipIndex = getStripDropIndex(
        'row',
        monitor.getClientOffset(),
      );
      if (item.kind === 'dimension') {
        onDropDimension(
          item.dimensionKey,
          'row',
          targetChipIndex,
          false,
          item.sourceAxis,
          item.sourceChipIndex,
        );
      } else {
        onDropValue(
          'row',
          targetChipIndex,
          item.sourceAxis,
          item.sourceChipIndex,
        );
      }
    },
  });
  const [, dropOnColStrip] = useDrop<DragItem, void, unknown>({
    accept: [dimensionDndType, valueDndType],
    drop: (item, monitor) => {
      if (monitor.didDrop()) {
        return;
      }
      const targetChipIndex = getStripDropIndex(
        'col',
        monitor.getClientOffset(),
      );
      if (item.kind === 'dimension') {
        onDropDimension(
          item.dimensionKey,
          'col',
          targetChipIndex,
          false,
          item.sourceAxis,
          item.sourceChipIndex,
        );
      } else {
        onDropValue(
          'col',
          targetChipIndex,
          item.sourceAxis,
          item.sourceChipIndex,
        );
      }
    },
  });

  return (
    <InteractionLayout style={height ? { height } : undefined}>
      <InteractionPanelWrap>{panel}</InteractionPanelWrap>
      <InteractionTableWrap>
        <PivotDragLayer />
        <ChipRow ref={dropOnColStrip} data-test="pivot-v3-col-chip-strip">
          {colChips.map((chip, index) => (
            <InteractionChip
              key={`col-${chip.id}`}
              axis="col"
              chip={chip}
              chipIndex={index}
              onRegisterRef={node => {
                colChipRefs.current[index] = node;
              }}
              onDropDimension={onDropDimension}
              onDropValue={onDropValue}
              onRemove={onRemoveDimension}
            />
          ))}
        </ChipRow>
        <TableRow>
          <ChipColumn ref={dropOnRowStrip} data-test="pivot-v3-row-chip-strip">
            {rowChips.map((chip, index) => (
              <InteractionChip
                key={`row-${chip.id}`}
                axis="row"
                chip={chip}
                chipIndex={index}
                onRegisterRef={node => {
                  rowChipRefs.current[index] = node;
                }}
                vertical
                onDropDimension={onDropDimension}
                onDropValue={onDropValue}
                onRemove={onRemoveDimension}
              />
            ))}
          </ChipColumn>
          <TableArea $height={tableHeight} $width={tableWidth}>
            {children}
          </TableArea>
        </TableRow>
      </InteractionTableWrap>
    </InteractionLayout>
  );
};
