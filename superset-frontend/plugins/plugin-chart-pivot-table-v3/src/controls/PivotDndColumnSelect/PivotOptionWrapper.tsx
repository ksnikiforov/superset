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
import { type ComponentProps } from 'react';
import { t } from '@apache-superset/core/translation';
import { useTheme, styled } from '@apache-superset/core/theme';
import { OptionWrapper } from '../../exploreImports';

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

/** Render the protected Values slot using Superset's shared drag option. */
export default function PivotOptionWrapper({
  isPlaceholder,
  withCaret,
  canDelete,
  ...props
}: ComponentProps<typeof OptionWrapper> & { isPlaceholder?: boolean }) {
  const theme = useTheme();
  return (
    <OptionWrapper
      {...props}
      withCaret={withCaret && !isPlaceholder}
      canDelete={!isPlaceholder && canDelete}
      labelContent={
        isPlaceholder ? (
          <span
            css={{
              color: theme.colorTextSecondary,
              display: 'inline-flex',
              alignItems: 'center',
              gap: theme.sizeXXS,
              lineHeight: 1.1,
            }}
          >
            <span css={{ marginRight: theme.sizeXS }}>{t('Σ Values')}</span>
            <PlaceholderBadge>{t('Fixed')}</PlaceholderBadge>
          </span>
        ) : undefined
      }
    />
  );
}
