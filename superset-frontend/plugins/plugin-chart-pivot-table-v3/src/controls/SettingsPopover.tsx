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
import { type ReactNode, type ComponentProps } from 'react';
import { styled } from '@apache-superset/core/theme';
import { Button, Popover, Tooltip } from '@superset-ui/core/components';

const SettingsButton = styled(Button)`
  height: ${({ theme }) => theme.sizeUnit * 5}px;
  min-height: ${({ theme }) => theme.sizeUnit * 5}px;
  min-width: ${({ theme }) => theme.sizeUnit * 5}px;
  width: ${({ theme }) => theme.sizeUnit * 5}px;
  padding: 0;
`;
const ButtonWrap = styled.div`
  display: flex;
  align-items: center;
  padding-right: ${({ theme }) => theme.sizeUnit}px;
`;

/** Shared trigger for pivot formatting and sorting settings. */
export function SettingsPopover({
  content,
  title,
  ariaLabel,
  testId,
  icon,
  active,
  isolateEvents = false,
}: {
  content: ReactNode;
  title: string;
  ariaLabel: string;
  testId: string;
  icon: ComponentProps<typeof Button>['icon'];
  active: boolean;
  isolateEvents?: boolean;
}) {
  return (
    <Popover
      content={content}
      overlayStyle={{ width: 'fit-content' }}
      trigger="click"
      placement="right"
      getPopupContainer={() => document.body}
    >
      <Tooltip title={title}>
        <ButtonWrap
          data-ignore-control-popover
          onClick={isolateEvents ? event => event.stopPropagation() : undefined}
          onMouseDown={
            isolateEvents ? event => event.stopPropagation() : undefined
          }
        >
          <SettingsButton
            aria-label={ariaLabel}
            data-test={testId}
            icon={icon}
            size="small"
            buttonStyle={active ? 'primary' : 'tertiary'}
          />
        </ButtonWrap>
      </Tooltip>
    </Popover>
  );
}
