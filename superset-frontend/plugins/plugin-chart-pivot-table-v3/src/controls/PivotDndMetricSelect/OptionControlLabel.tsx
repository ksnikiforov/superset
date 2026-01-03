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
import { ReactNode, useRef } from 'react';
import { DropTargetMonitor, useDrag, useDrop } from 'react-dnd';
import { css, styled, t, useTheme } from '@superset-ui/core';
import { Icons, InfoTooltip, Tooltip } from '@superset-ui/core/components';
import AdhocMetric from 'src/explore/components/controls/MetricControl/AdhocMetric';
import { savedMetricType } from 'src/explore/components/controls/MetricControl/types';
import { StyledMetricOption } from 'src/explore/components/optionRenderers';

export const DragContainer = styled.div`
  margin-bottom: ${({ theme }) => theme.sizeUnit}px;
  :last-child {
    margin-bottom: 0;
  }
`;

export const OptionControlContainer = styled.div<{
  withCaret?: boolean;
}>`
  display: flex;
  align-items: center;
  width: 100%;
  font-size: ${({ theme }) => theme.fontSizeSM}px;
  height: ${({ theme }) => theme.sizeUnit * 6}px;
  background-color: ${({ theme }) => theme.colorBgLayout};
  border-radius: 3px;
  cursor: ${({ withCaret }) => (withCaret ? 'pointer' : 'default')};
  :hover {
    background-color: ${({ theme }) => theme.colorPrimaryBgHover};
  }
`;

export const Label = styled.div`
  ${({ theme }) => `
    display: flex;
    width: 100%;
    overflow: hidden;
    text-overflow: ellipsis;
    align-items: center;
    white-space: nowrap;
    padding-left: ${theme.sizeUnit}px;
    svg {
      margin-right: ${theme.sizeUnit}px;
    }
    .type-label {
      margin-right: ${theme.sizeUnit * 2}px;
      margin-left: ${theme.sizeUnit}px;
      font-weight: ${theme.fontWeightNormal};
      width: auto;
    }
    .option-label {
      display: inline;
    }
  `}
`;

const RightNodeContainer = styled.div`
  display: flex;
  align-items: center;
  margin-left: ${({ theme }) => theme.sizeUnit}px;
`;

const LabelText = styled.span`
  overflow: hidden;
  text-overflow: ellipsis;
`;

export const CaretContainer = styled.div`
  height: 100%;
  border-left: solid 1px ${({ theme }) => theme.colorSplit};
  margin-left: auto;
`;

export const CloseContainer = styled.div`
  height: auto;
  width: ${({ theme }) => theme.sizeUnit * 6}px;
  border-right: solid 1px ${({ theme }) => theme.colorBorder};
  cursor: pointer;
`;

const StyledInfoTooltip = styled(InfoTooltip)`
  margin: 0 ${({ theme }) => theme.sizeUnit}px;
`;

type DragItem = {
  dragIndex: number;
  type: string;
};

type OptionControlLabelProps = {
  label: string | ReactNode;
  savedMetric?: savedMetricType & { error_text?: string };
  adhocMetric?: AdhocMetric;
  onRemove: () => void;
  onMoveLabel: (dragIndex: number, hoverIndex: number) => void;
  onDropLabel: () => void;
  withCaret?: boolean;
  isFunction?: boolean;
  type: string;
  index: number;
  isExtra?: boolean;
  datasourceWarningMessage?: string;
  tooltipTitle?: string;
  multi?: boolean;
  rightNode?: ReactNode;
};

const OptionControlLabel = ({
  label,
  savedMetric,
  adhocMetric,
  onRemove,
  onMoveLabel,
  onDropLabel,
  withCaret,
  isFunction,
  type,
  index,
  isExtra,
  datasourceWarningMessage,
  tooltipTitle,
  multi = true,
  rightNode,
  ...props
}: OptionControlLabelProps) => {
  const theme = useTheme();
  const ref = useRef<HTMLDivElement>(null);
  const labelRef = useRef<HTMLDivElement>(null);
  const hasMetricName = savedMetric?.metric_name;
  const [, drop] = useDrop({
    accept: type,
    drop() {
      if (!multi) {
        return;
      }
      onDropLabel?.();
    },
    hover(item: DragItem, monitor: DropTargetMonitor) {
      if (!multi) {
        return;
      }
      if (!ref.current) {
        return;
      }
      const { dragIndex } = item;
      const hoverIndex = index;
      if (dragIndex === hoverIndex) {
        return;
      }
      const hoverBoundingRect = ref.current?.getBoundingClientRect();
      const hoverMiddleY =
        (hoverBoundingRect.bottom - hoverBoundingRect.top) / 2;
      const clientOffset = monitor.getClientOffset();
      const hoverClientY = clientOffset?.y
        ? clientOffset?.y - hoverBoundingRect.top
        : 0;
      if (dragIndex < hoverIndex && hoverClientY < hoverMiddleY) {
        return;
      }
      if (dragIndex > hoverIndex && hoverClientY > hoverMiddleY) {
        return;
      }
      onMoveLabel?.(dragIndex, hoverIndex);
      // eslint-disable-next-line no-param-reassign
      item.dragIndex = hoverIndex;
    },
  });
  const [{ isDragging }, drag] = useDrag({
    item: {
      type,
      dragIndex: index,
      value: savedMetric?.metric_name ? savedMetric : adhocMetric,
    },
    collect: monitor => ({
      isDragging: monitor.isDragging(),
    }),
  });

  const getLabelContent = () => {
    const shouldShowTooltip =
      (!isDragging &&
        typeof label === 'string' &&
        tooltipTitle &&
        label &&
        tooltipTitle !== label) ||
      (!isDragging &&
        labelRef &&
        labelRef.current &&
        labelRef.current.scrollWidth > labelRef.current.clientWidth);

    if (savedMetric && hasMetricName) {
      return (
        <StyledMetricOption
          metric={savedMetric}
          labelRef={labelRef}
          shouldShowTooltip={!isDragging}
        />
      );
    }
    if (!shouldShowTooltip) {
      return <LabelText ref={labelRef}>{label}</LabelText>;
    }
    return (
      <Tooltip title={tooltipTitle || label}>
        <LabelText ref={labelRef}>{label}</LabelText>
      </Tooltip>
    );
  };

  const getOptionControlContent = () => (
    <OptionControlContainer
      withCaret={withCaret}
      data-test="option-label"
      {...props}
      css={css`
        text-align: center;
      `}
    >
      <CloseContainer
        role="button"
        data-test="remove-control-button"
        onClick={onRemove}
      >
        <Icons.CloseOutlined
          iconSize="m"
          iconColor={theme.colorIcon}
          css={css`
            vertical-align: sub;
          `}
        />
      </CloseContainer>
      <Label data-test="control-label">
        {isFunction && <Icons.FunctionOutlined iconSize="m" />}
        {getLabelContent()}
      </Label>
      {(!!datasourceWarningMessage || isExtra) && (
        <StyledInfoTooltip
          type="warning"
          placement="top"
          tooltip={
            datasourceWarningMessage ||
            t(`
                This filter was inherited from the dashboard's context.
                It won't be saved when saving the chart.
              `)
          }
        />
      )}
      {rightNode && <RightNodeContainer>{rightNode}</RightNodeContainer>}
      {withCaret && (
        <CaretContainer>
          <Icons.RightOutlined
            iconSize="m"
            css={css`
              margin: ${theme.sizeUnit}px;
            `}
            iconColor={theme.colorIcon}
          />
        </CaretContainer>
      )}
    </OptionControlContainer>
  );

  drag(drop(ref));
  return <DragContainer ref={ref}>{getOptionControlContent()}</DragContainer>;
};

export default OptionControlLabel;
