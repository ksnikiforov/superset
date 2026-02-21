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
  ReactNode,
  RefObject,
  useCallback,
  useContext,
  useEffect,
  useMemo,
} from 'react';
import { useDrop, DropTargetMonitor } from 'react-dnd';
import { t } from '@superset-ui/core';
import { ControlHeader } from '@superset-ui/chart-controls';
import { Icons } from '@superset-ui/core/components/Icons';
import {
  AddControlLabel,
  DatasourcePanelDndItem,
  DndItemType,
  DndItemValue,
  DndLabelsContainer,
  DraggingContext,
  DropzoneContext,
  HeaderContainer,
} from '../../exploreImports';

export type PivotDndSelectLabelProps = {
  name: string;
  accept:
    | DndItemType
    | DndItemType[]
    | string
    | string[]
    | (DndItemType | string)[];
  ghostButtonText: string;
  onDrop: (item: DatasourcePanelDndItem, monitor: DropTargetMonitor) => void;
  canDrop: (item: DatasourcePanelDndItem) => boolean;
  canDropValue?: (value: DndItemValue) => boolean;
  onDropValue?: (value: DndItemValue) => void;
  valuesRenderer: () => ReactNode;
  displayGhostButton?: boolean;
  onClickGhostButton: () => void;
  isLoading?: boolean;
  containerRef?: RefObject<HTMLDivElement>;
};

export default function PivotDndSelectLabel({
  displayGhostButton = true,
  accept,
  valuesRenderer,
  isLoading,
  containerRef,
  ...props
}: PivotDndSelectLabelProps) {
  const canDropProp = props.canDrop;
  const canDropValueProp = props.canDropValue;

  const dropValidator = useCallback(
    (item: DatasourcePanelDndItem) =>
      canDropProp(item) && (canDropValueProp?.(item.value) ?? true),
    [canDropProp, canDropValueProp],
  );

  const [{ isOver, canDrop }, datasourcePanelDrop] = useDrop({
    accept: isLoading ? [] : accept,

    drop: (item: DatasourcePanelDndItem, monitor) => {
      props.onDrop(item, monitor);
      props.onDropValue?.(item.value);
    },

    canDrop: dropValidator,

    collect: monitor => ({
      isOver: monitor.isOver(),
      canDrop: monitor.canDrop(),
      type: monitor.getItemType(),
    }),
  });

  const dispatch = useContext(DropzoneContext)[1];

  useEffect(() => {
    dispatch({ key: props.name, canDrop: dropValidator });
    return () => {
      dispatch({ key: props.name });
    };
  }, [dispatch, props.name, dropValidator]);

  const isDragging = useContext(DraggingContext);

  const values = useMemo(() => valuesRenderer(), [valuesRenderer]);

  function renderGhostButton() {
    return (
      <AddControlLabel
        cancelHover={!props.onClickGhostButton}
        onClick={props.onClickGhostButton}
      >
        <Icons.PlusOutlined iconSize="m" />
        {t(props.ghostButtonText)}
      </AddControlLabel>
    );
  }

  return (
    <div ref={datasourcePanelDrop}>
      <HeaderContainer>
        <ControlHeader {...props} />
      </HeaderContainer>
      <DndLabelsContainer
        ref={containerRef}
        data-test="dnd-labels-container"
        canDrop={canDrop}
        isOver={isOver}
        isDragging={isDragging}
        isLoading={isLoading}
      >
        {values}
        {displayGhostButton && renderGhostButton()}
      </DndLabelsContainer>
    </div>
  );
}
