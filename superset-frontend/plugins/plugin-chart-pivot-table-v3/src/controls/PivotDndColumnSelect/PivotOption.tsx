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
import { ReactNode, useCallback } from 'react';
import { css, styled, t, useTheme } from '@superset-ui/core';
import { Icons, InfoTooltip } from '@superset-ui/core/components';
import {
  CaretContainer,
  CloseContainer,
  Label,
  OptionControlContainer,
} from 'src/explore/components/controls/OptionControls';

export type PivotOptionProps = {
  children?: ReactNode;
  index: number;
  clickClose: (index: number) => void;
  withCaret?: boolean;
  isExtra?: boolean;
  datasourceWarningMessage?: string;
  canDelete?: boolean;
  rightNode?: ReactNode;
};

const StyledInfoTooltip = styled(InfoTooltip)`
  margin: 0 ${({ theme }) => theme.sizeUnit}px;
`;

const RightNodeContainer = styled.div`
  display: flex;
  align-items: center;
  margin-left: ${({ theme }) => theme.sizeUnit}px;
`;

export default function PivotOption({
  children,
  index,
  clickClose,
  withCaret,
  isExtra,
  datasourceWarningMessage,
  rightNode,
  canDelete = true,
}: PivotOptionProps) {
  const theme = useTheme();
  const onClickClose = useCallback(
    e => {
      e.stopPropagation();
      clickClose(index);
    },
    [clickClose, index],
  );
  return (
    <OptionControlContainer data-test="option-label" withCaret={withCaret}>
      {canDelete && (
        <CloseContainer
          css={css`
            text-align: center;
          `}
          role="button"
          data-test="remove-control-button"
          onClick={onClickClose}
        >
          <Icons.CloseOutlined
            iconSize="m"
            iconColor={theme.colorIcon}
            css={css`
              vertical-align: sub;
            `}
          />
        </CloseContainer>
      )}
      <Label data-test="control-label">{children}</Label>
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
}
