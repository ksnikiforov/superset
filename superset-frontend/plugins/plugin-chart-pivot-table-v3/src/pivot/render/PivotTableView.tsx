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
  type CSSProperties,
  type KeyboardEvent,
  type MouseEvent,
  type ReactNode,
  type RefObject,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import {
  DownOutlined,
  LoadingOutlined,
  MinusSquareOutlined,
  PlusSquareOutlined,
  UpOutlined,
} from '@ant-design/icons';
import { type DataRecordValue, styled, t } from '@superset-ui/core';
import { Alert, Button, Loading } from '@superset-ui/core/components';
import {
  type MetricFormattingField,
  type MetricFormattingScope,
  type PivotMetricDatabarMap,
  type PivotResultCell,
  type PivotTreeData,
  type PivotTreeNode,
  type TotalPosition,
} from '../../types';
import { serializeCellKey } from '../../utils';
import { type ChartDataWarning } from '../data/ChartDataClient';
import { rootKey } from '../viewModel';
import { type RenderModel, type FormattingKeys } from '../shared/types';

const ROW_INDENT_PX = 14;
const ROW_TOGGLE_SLOT_PX = 16;
const ROW_LABEL_GAP_PX = 3;
const STICKY_TOTAL_ROW_FALLBACK_HEIGHT_PX = 28;

const Container = styled.div<{ height: number; width: number }>`
  ${({ height, width }) => `
    height: ${height}px;
    width: ${width}px;
    overflow: auto;
    position: relative;
    scrollbar-width: none;
    -ms-overflow-style: none;

    &::-webkit-scrollbar {
      width: 0;
      height: 0;
    }
  `}
`;

const ErrorWrapper = styled.div`
  height: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: ${({ theme }) => theme.sizeLG}px;
`;

const ErrorContent = styled.div`
  max-width: 640px;
  width: 100%;
  display: flex;
  flex-direction: column;
  gap: ${({ theme }) => theme.sizeMD}px;
`;

const StyledTable = styled.table<{ $stickyHeaders: boolean }>`
  --pivot-border-color: ${({ theme }) => theme.colorBorderSecondary};
  width: max-content;
  min-width: 100%;
  border-collapse: separate;
  border-spacing: 0;
  font-size: 12px;

  th,
  td {
    border-right: 1px solid var(--pivot-border-color);
    border-bottom: 1px solid var(--pivot-border-color);
    padding: 6px 8px;
  }

  thead tr:first-child th {
    border-top: 1px solid var(--pivot-border-color);
  }

  thead th:first-child,
  tbody th {
    border-left: 1px solid var(--pivot-border-color);
  }

  thead th {
    background: ${({ theme }) => theme.colorBgLayout};
    text-align: left;
    vertical-align: top;
    ${({ $stickyHeaders }) =>
      $stickyHeaders
        ? `
      position: sticky;
      top: 0;
      z-index: 4;
    `
        : ''}
  }

  td.value-cell {
    text-align: right;
  }

  td.databar-cell {
    padding: 0;
    position: relative;
  }

  tbody th {
    background: ${({ theme }) => theme.colorBgContainer};
    text-align: left;
    vertical-align: top;
    ${({ $stickyHeaders }) =>
      $stickyHeaders
        ? `
      position: sticky;
      left: 0;
      z-index: 3;
    `
        : ''}
  }

  .subtotal-cell {
    font-weight: 600;
  }

  .pivot-null-label {
    color: ${({ theme }) => theme.colorTextQuaternary};
  }

  .pivot-sticky-corner {
    ${({ $stickyHeaders }) =>
      $stickyHeaders
        ? `
      position: sticky;
      top: 0;
      left: 0;
      z-index: 5;
    `
        : ''}
  }

  tbody tr.pivot-grand-total-row td,
  tbody tr.pivot-grand-total-row th {
    background-color: ${({ theme }) => theme.colorBgContainer};
  }

  ${({ $stickyHeaders }) =>
    $stickyHeaders
      ? `
    tbody tr.pivot-grand-total-row--top td,
    tbody tr.pivot-grand-total-row--top th {
      position: sticky;
      top: calc(
        var(--pivot-header-offset, 0px) + var(--pivot-grand-total-offset, 0px)
      );
      z-index: 3;
    }

    tbody tr.pivot-grand-total-row--bottom td,
    tbody tr.pivot-grand-total-row--bottom th {
      position: sticky;
      bottom: var(--pivot-grand-total-offset, 0px);
      z-index: 3;
    }

    tbody tr.pivot-grand-total-row--top th,
    tbody tr.pivot-grand-total-row--bottom th {
      z-index: 4;
    }
  `
      : ''}
`;

const HeaderCell = styled.div`
  display: flex;
  align-items: center;
  gap: ${ROW_LABEL_GAP_PX}px;
`;

const ColumnHeaderCell = styled(HeaderCell)`
  align-items: flex-start;
  line-height: 1.2;
`;

const RowHeaderCell = styled(HeaderCell)``;

const RowToggleSlot = styled.span`
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: ${ROW_TOGGLE_SLOT_PX}px;
  min-width: ${ROW_TOGGLE_SLOT_PX}px;
  height: ${ROW_TOGGLE_SLOT_PX}px;
  flex: 0 0 ${ROW_TOGGLE_SLOT_PX}px;
`;

const ColumnControlSlot = styled.span`
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: ${ROW_TOGGLE_SLOT_PX}px;
  min-width: ${ROW_TOGGLE_SLOT_PX}px;
  height: ${ROW_TOGGLE_SLOT_PX}px;
  flex: 0 0 ${ROW_TOGGLE_SLOT_PX}px;
`;

const SortIndicator = styled.span`
  display: inline-flex;
  align-items: center;
  justify-content: center;
  color: ${({ theme }) => theme.colorTextSecondary};
`;

const ToggleButton = styled.button`
  border: none;
  background: transparent;
  padding: 0;
  cursor: pointer;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 16px;
  height: 16px;
  color: ${({ theme }) => theme.colorText};

  &:disabled {
    cursor: default;
    color: ${({ theme }) => theme.colorTextQuaternary};
  }
`;

const Spinner = styled(LoadingOutlined)`
  font-size: 13px;
  color: ${({ theme }) => theme.colorTextHeading};
  text-shadow:
    0 0 1px currentColor,
    0 0 2px currentColor;

  & svg {
    stroke: currentColor;
    stroke-width: 1;
  }
`;

const normalizeCssColor = (rawValue: unknown) => {
  if (rawValue === null || rawValue === undefined) {
    return undefined;
  }
  const value = String(rawValue).trim();
  if (!value) {
    return undefined;
  }
  return value;
};

const normalizeD3Format = (rawValue: unknown) => {
  if (typeof rawValue !== 'string') {
    return undefined;
  }
  const value = rawValue.trim();
  return value.length > 0 ? value : undefined;
};

const isNullLabelValue = (node: PivotTreeNode) => {
  if (!node.path || node.path.length === 0) {
    return false;
  }
  const last = node.path[node.path.length - 1];
  return last === null;
};

const shouldApplyMetricFormatting = (
  scope: MetricFormattingScope,
  isSubtotal: boolean,
  isGrandTotal: boolean,
) => {
  if (scope === 'values') {
    return !isSubtotal && !isGrandTotal;
  }
  if (scope === 'values_totals') {
    return !isGrandTotal;
  }
  return true;
};

type PivotTableViewProps = {
  height: number;
  width: number;
  renderModel: RenderModel;
  tree: PivotTreeData;
  expandedRows: Set<string>;
  expandedCols: Set<string>;
  errorMessage?: string;
  onRetry: () => void;
  warnings?: ChartDataWarning[];
  showGlobalLoader: boolean;
  showCornerLoader?: boolean;
  stickyHeaders: boolean;
  headerOffset: number;
  headerRowOffsets: number[];
  headerRef: RefObject<HTMLTableSectionElement>;
  themeColor?: string;
  colTotalPosition: TotalPosition;
  metricFormattingScope: MetricFormattingScope;
  metricDatabars: PivotMetricDatabarMap;
  formattingKeyMap: Record<string, FormattingKeys>;
  evaluateExcelMetricFormatting: (
    metricKey: string,
    field: MetricFormattingField,
    values: Record<string, DataRecordValue | undefined>,
    currentValue: DataRecordValue | undefined,
  ) => unknown;
  databarColumnMinWidths: Map<string, number>;
  onToggleNode: (axis: 'row' | 'col', node: PivotTreeNode) => void;
  onSortColumn?: (node: PivotTreeNode) => void;
  isColumnSortable?: (node: PivotTreeNode) => boolean;
  getColumnSortOrder?: (node: PivotTreeNode) => 'asc' | 'desc' | undefined;
  shouldShowToggle: (axis: 'row' | 'col', node: PivotTreeNode) => boolean;
  showRowSpinner: (key: string) => boolean;
  showColSpinner: (key: string) => boolean;
  formatLabel: (node: PivotTreeNode, axis: 'row' | 'col') => string;
  isRowAggregateBold: (node?: PivotTreeNode) => boolean;
  isColAggregateBold: (node?: PivotTreeNode) => boolean;
  getNodeDimDepth: (node: PivotTreeNode) => number;
  getTotalBackground: (row?: PivotTreeNode) => string | undefined;
  resolveDimensionStyle: (
    axis: 'row' | 'col',
    node: PivotTreeNode,
    target: 'label' | 'cell',
  ) => CSSProperties | undefined;
  deriveMetricKey: (rowNode: PivotTreeNode, colNode: PivotTreeNode) => string;
  isMetricGrandTotalNode: (node: PivotTreeNode) => boolean;
  renderCellContent: (
    rowNode: PivotTreeNode,
    colNode: PivotTreeNode,
    metricKey: string,
    d3FormatOverride?: string,
  ) => ReactNode;
  renderDatabarContent: (
    rowNode: PivotTreeNode,
    colNode: PivotTreeNode,
    cell: PivotResultCell,
    metricKey: string,
    d3FormatOverride?: string,
  ) => ReactNode;
  emitCrossFilters?: boolean;
  handleCellClick: (rowNode: PivotTreeNode, colNode: PivotTreeNode) => void;
  handleCellKeyDown: (
    event: KeyboardEvent<HTMLTableCellElement>,
    rowNode: PivotTreeNode,
    colNode: PivotTreeNode,
  ) => void;
  handleCellContextMenu: (
    event: MouseEvent<HTMLTableCellElement>,
    rowNode: PivotTreeNode,
    colNode: PivotTreeNode,
  ) => void;
  rowAxisLabels?: string[];
};

export const PivotTableView = ({
  height,
  width,
  renderModel,
  tree,
  expandedRows,
  expandedCols,
  errorMessage,
  onRetry,
  showGlobalLoader,
  showCornerLoader = false,
  stickyHeaders,
  headerOffset,
  headerRowOffsets,
  headerRef,
  themeColor,
  colTotalPosition,
  metricFormattingScope,
  metricDatabars,
  formattingKeyMap,
  evaluateExcelMetricFormatting,
  databarColumnMinWidths,
  onToggleNode,
  onSortColumn,
  isColumnSortable,
  getColumnSortOrder,
  shouldShowToggle,
  showRowSpinner,
  showColSpinner,
  formatLabel,
  isRowAggregateBold,
  isColAggregateBold,
  getNodeDimDepth,
  getTotalBackground,
  resolveDimensionStyle,
  deriveMetricKey,
  isMetricGrandTotalNode,
  renderCellContent,
  renderDatabarContent,
  emitCrossFilters,
  handleCellClick,
  handleCellKeyDown,
  handleCellContextMenu,
  rowAxisLabels = [],
}: PivotTableViewProps) => {
  const { visibleRows, visibleCols, columnHeaderRows, showRowRoot } =
    renderModel;
  const stickyRowRefs = useRef<Record<string, HTMLTableRowElement | null>>({});
  const [stickyTotalRowOffsets, setStickyTotalRowOffsets] = useState<
    Record<string, number>
  >({});

  const isGrandTotalLikeRow = useMemo(
    () => (row: PivotTreeNode) =>
      (showRowRoot && row.key === rootKey) || isMetricGrandTotalNode(row),
    [isMetricGrandTotalNode, showRowRoot],
  );

  const stickyTopRows = useMemo(
    () =>
      colTotalPosition === 'end'
        ? []
        : visibleRows.filter(row => isGrandTotalLikeRow(row)),
    [colTotalPosition, isGrandTotalLikeRow, visibleRows],
  );
  const stickyBottomRows = useMemo(
    () =>
      colTotalPosition === 'end'
        ? visibleRows.filter(row => isGrandTotalLikeRow(row))
        : [],
    [colTotalPosition, isGrandTotalLikeRow, visibleRows],
  );

  useLayoutEffect(() => {
    if (!stickyHeaders) {
      if (Object.keys(stickyTotalRowOffsets).length > 0) {
        setStickyTotalRowOffsets({});
      }
      return;
    }

    const nextOffsets: Record<string, number> = {};
    let runningTopOffset = 0;
    stickyTopRows.forEach(row => {
      nextOffsets[row.key] = runningTopOffset;
      const measuredHeight =
        stickyRowRefs.current[row.key]?.getBoundingClientRect().height ?? 0;
      runningTopOffset +=
        measuredHeight > 0
          ? measuredHeight
          : STICKY_TOTAL_ROW_FALLBACK_HEIGHT_PX;
    });

    let runningBottomOffset = 0;
    [...stickyBottomRows].reverse().forEach(row => {
      nextOffsets[row.key] = runningBottomOffset;
      const measuredHeight =
        stickyRowRefs.current[row.key]?.getBoundingClientRect().height ?? 0;
      runningBottomOffset +=
        measuredHeight > 0
          ? measuredHeight
          : STICKY_TOTAL_ROW_FALLBACK_HEIGHT_PX;
    });

    const prevKeys = Object.keys(stickyTotalRowOffsets);
    const nextKeys = Object.keys(nextOffsets);
    const hasSameShape =
      prevKeys.length === nextKeys.length &&
      prevKeys.every(key => nextOffsets[key] === stickyTotalRowOffsets[key]);
    if (!hasSameShape) {
      setStickyTotalRowOffsets(nextOffsets);
    }
  }, [stickyHeaders, stickyBottomRows, stickyTopRows, stickyTotalRowOffsets]);

  const containerStyle: CSSProperties & {
    '--pivot-header-offset': string;
  } = {
    '--pivot-header-offset': `${stickyHeaders ? headerOffset : 0}px`,
  };

  return (
    <Container height={height} width={width} style={containerStyle}>
      {errorMessage ? (
        <ErrorWrapper>
          <ErrorContent>
            <Alert
              type="error"
              showIcon
              message={t('Error loading Pivot Table')}
              description={errorMessage}
            />
            <Button type="primary" onClick={onRetry}>
              {t('Retry')}
            </Button>
          </ErrorContent>
        </ErrorWrapper>
      ) : showGlobalLoader ? (
        <Loading />
      ) : (
        <StyledTable
          className="pivot-v3-table pvtTable"
          $stickyHeaders={stickyHeaders}
          data-sticky-headers={stickyHeaders}
          data-pivot-row-axis-labels={JSON.stringify(rowAxisLabels)}
        >
          <thead ref={headerRef}>
            {columnHeaderRows.length === 0 ? (
              <tr>
                <th
                  className="pivot-sticky-corner"
                  style={
                    themeColor
                      ? { backgroundColor: themeColor, fontWeight: 600 }
                      : { fontWeight: 600 }
                  }
                >
                  {showCornerLoader ? (
                    <Spinner aria-label={t('Loading')} />
                  ) : (
                    t('Rows')
                  )}
                </th>
              </tr>
            ) : (
              columnHeaderRows.map((rowCells, rowIdx) => (
                <tr key={`col-header-row-${rowIdx}`}>
                  {rowIdx === 0 && (
                    <th
                      rowSpan={columnHeaderRows.length}
                      className="pivot-sticky-corner"
                      style={
                        themeColor
                          ? { backgroundColor: themeColor, fontWeight: 600 }
                          : { fontWeight: 600 }
                      }
                    >
                      {showCornerLoader ? (
                        <Spinner aria-label={t('Loading')} />
                      ) : (
                        t('Rows')
                      )}
                    </th>
                  )}
                  {rowCells.map(cell => {
                    const showToggle = shouldShowToggle('col', cell.node);
                    const sortable = isColumnSortable?.(cell.node) ?? false;
                    const sortOrder = getColumnSortOrder?.(cell.node);
                    const isSubtotalHeader = isColAggregateBold(cell.node);
                    const colHeaderFormatting = resolveDimensionStyle(
                      'col',
                      cell.node,
                      'label',
                    );
                    const colHeaderStyle = {
                      ...(themeColor ? { backgroundColor: themeColor } : {}),
                      ...(colHeaderFormatting || {}),
                      ...(stickyHeaders
                        ? { top: `${headerRowOffsets[rowIdx] ?? 0}px` }
                        : {}),
                    };
                    const colHeaderStyleResolved =
                      Object.keys(colHeaderStyle).length > 0
                        ? colHeaderStyle
                        : undefined;
                    return (
                      <th
                        key={`col-header-${cell.node.key}-${rowIdx}`}
                        colSpan={cell.colSpan}
                        rowSpan={cell.rowSpan}
                        className={
                          isSubtotalHeader ? 'subtotal-cell' : undefined
                        }
                        style={colHeaderStyleResolved}
                        onClick={
                          sortable && onSortColumn
                            ? () => onSortColumn(cell.node)
                            : undefined
                        }
                      >
                        <ColumnHeaderCell>
                          <ColumnControlSlot>
                            {showToggle && (
                              <ToggleButton
                                type="button"
                                onClick={event => {
                                  event.stopPropagation();
                                  onToggleNode('col', cell.node);
                                }}
                                disabled={showColSpinner(cell.node.key)}
                              >
                                {showColSpinner(cell.node.key) ? (
                                  <Spinner />
                                ) : expandedCols.has(cell.node.key) ? (
                                  <MinusSquareOutlined />
                                ) : (
                                  <PlusSquareOutlined />
                                )}
                              </ToggleButton>
                            )}
                          </ColumnControlSlot>
                          <span
                            className={
                              isNullLabelValue(cell.node)
                                ? 'pivot-null-label'
                                : undefined
                            }
                          >
                            {formatLabel(cell.node, 'col')}
                          </span>
                          <ColumnControlSlot>
                            {sortOrder ? (
                              <SortIndicator
                                aria-label={
                                  sortOrder === 'desc'
                                    ? t('Sorted descending')
                                    : t('Sorted ascending')
                                }
                              >
                                {sortOrder === 'desc' ? (
                                  <DownOutlined />
                                ) : (
                                  <UpOutlined />
                                )}
                              </SortIndicator>
                            ) : null}
                          </ColumnControlSlot>
                        </ColumnHeaderCell>
                      </th>
                    );
                  })}
                </tr>
              ))
            )}
          </thead>
          <tbody>
            {visibleRows.map(row => {
              const showToggle = shouldShowToggle('row', row);
              const rowAggregateBold = isRowAggregateBold(row);
              const isSubtotalHeader = rowAggregateBold;
              const isGrandTotalRow = showRowRoot && row.key === rootKey;
              const isMetricGrandTotalRow = isMetricGrandTotalNode(row);
              const isGrandTotalLike = isGrandTotalRow || isMetricGrandTotalRow;
              const grandTotalPositionClass =
                colTotalPosition === 'end'
                  ? 'pivot-grand-total-row--bottom'
                  : 'pivot-grand-total-row--top';
              const rowClassName = isGrandTotalLike
                ? `pivot-grand-total-row ${grandTotalPositionClass}`
                : undefined;
              const rowStickyOffset = stickyTotalRowOffsets[row.key] ?? 0;
              const rowStyle =
                isGrandTotalLike && stickyHeaders
                  ? ({
                      '--pivot-grand-total-offset': `${rowStickyOffset}px`,
                    } as CSSProperties & {
                      '--pivot-grand-total-offset': string;
                    })
                  : undefined;
              const rowTotalBg = getTotalBackground(row);
              const rowHeaderFormatting = resolveDimensionStyle(
                'row',
                row,
                'label',
              );
              const rowHeaderStyle = {
                ...(rowTotalBg ? { backgroundColor: rowTotalBg } : {}),
                ...(rowHeaderFormatting || {}),
              };
              const rowHeaderStyleResolved =
                Object.keys(rowHeaderStyle).length > 0
                  ? rowHeaderStyle
                  : undefined;
              const rowDepthForExport = isMetricGrandTotalRow
                ? 0
                : getNodeDimDepth(row);
              const rowIndent = rowDepthForExport * ROW_INDENT_PX;
              const isRowLoading = showRowSpinner(row.key);
              return (
                <tr
                  key={row.key}
                  className={rowClassName}
                  style={rowStyle}
                  ref={
                    isGrandTotalLike
                      ? rowElement => {
                          stickyRowRefs.current[row.key] = rowElement;
                        }
                      : undefined
                  }
                >
                  <th
                    className={isSubtotalHeader ? 'subtotal-cell' : undefined}
                    style={rowHeaderStyleResolved}
                  >
                    <RowHeaderCell
                      style={{ paddingLeft: rowIndent }}
                      data-pivot-row-depth={rowDepthForExport}
                    >
                      <RowToggleSlot className="pivot-row-toggle-slot">
                        {showToggle ? (
                          <ToggleButton
                            type="button"
                            onClick={() => onToggleNode('row', row)}
                            disabled={isRowLoading}
                          >
                            {isRowLoading ? (
                              <Spinner />
                            ) : expandedRows.has(row.key) ? (
                              <MinusSquareOutlined />
                            ) : (
                              <PlusSquareOutlined />
                            )}
                          </ToggleButton>
                        ) : isRowLoading ? (
                          <Spinner aria-label={t('Loading')} />
                        ) : null}
                      </RowToggleSlot>
                      <span
                        data-pivot-row-label
                        className={
                          isNullLabelValue(row) ? 'pivot-null-label' : undefined
                        }
                      >
                        {formatLabel(row, 'row')}
                      </span>
                    </RowHeaderCell>
                  </th>
                  {visibleCols.map(col => {
                    const cellKey = serializeCellKey(row.key, col.key);
                    const cell = tree.cells[cellKey];
                    const metricKey = deriveMetricKey(row, col);
                    const formattingKeys = metricKey
                      ? formattingKeyMap[metricKey]
                      : undefined;
                    const colAggregateBold = isColAggregateBold(col);
                    const isSubtotalCell = rowAggregateBold || colAggregateBold;
                    const isGrandTotalCell =
                      row.path.length === 0 ||
                      col.path.length === 0 ||
                      isMetricGrandTotalNode(row) ||
                      isMetricGrandTotalNode(col);
                    const rowCellFormatting = !isGrandTotalCell
                      ? resolveDimensionStyle('row', row, 'cell')
                      : undefined;
                    const colCellFormatting = !isGrandTotalCell
                      ? resolveDimensionStyle('col', col, 'cell')
                      : undefined;
                    const applyColorFormatting = !!(
                      cell &&
                      metricKey &&
                      shouldApplyMetricFormatting(
                        metricFormattingScope,
                        isSubtotalCell,
                        isGrandTotalCell,
                      )
                    );
                    const currentValue =
                      cell && metricKey ? cell.values[metricKey] : undefined;
                    const backgroundColor =
                      (applyColorFormatting
                        ? normalizeCssColor(
                            evaluateExcelMetricFormatting(
                              metricKey,
                              'backgroundColor',
                              cell.values,
                              currentValue,
                            ),
                          )
                        : undefined) ??
                      (applyColorFormatting && formattingKeys?.backgroundColor
                        ? normalizeCssColor(
                            cell.values[formattingKeys.backgroundColor],
                          )
                        : undefined);
                    const textColor =
                      (applyColorFormatting
                        ? normalizeCssColor(
                            evaluateExcelMetricFormatting(
                              metricKey,
                              'textColor',
                              cell.values,
                              currentValue,
                            ),
                          )
                        : undefined) ??
                      (applyColorFormatting && formattingKeys?.textColor
                        ? normalizeCssColor(
                            cell.values[formattingKeys.textColor],
                          )
                        : undefined);
                    const d3FormatKey = formattingKeys?.d3Format;
                    const d3FormatOverride =
                      (cell && metricKey
                        ? normalizeD3Format(
                            evaluateExcelMetricFormatting(
                              metricKey,
                              'd3Format',
                              cell.values,
                              currentValue,
                            ),
                          )
                        : undefined) ??
                      (cell && d3FormatKey
                        ? normalizeD3Format(cell.values[d3FormatKey])
                        : undefined);
                    const cellTotalBg = rowTotalBg;
                    const databarConfig = metricKey
                      ? metricDatabars[metricKey]
                      : undefined;
                    const colMinWidth = databarColumnMinWidths.get(col.key);
                    const isDatabarCell = !!databarConfig?.type;
                    const cellClassName = [
                      isSubtotalCell ? 'subtotal-cell' : '',
                      'value-cell',
                      isDatabarCell ? 'databar-cell' : '',
                    ]
                      .filter(Boolean)
                      .join(' ');
                    const cellStyle = {
                      ...(cellTotalBg ? { backgroundColor: cellTotalBg } : {}),
                      ...(colCellFormatting?.backgroundColor
                        ? { backgroundColor: colCellFormatting.backgroundColor }
                        : {}),
                      ...(colCellFormatting?.color
                        ? { color: colCellFormatting.color }
                        : {}),
                      ...(rowCellFormatting?.backgroundColor
                        ? { backgroundColor: rowCellFormatting.backgroundColor }
                        : {}),
                      ...(rowCellFormatting?.color
                        ? { color: rowCellFormatting.color }
                        : {}),
                      ...(backgroundColor ? { backgroundColor } : {}),
                      ...(textColor ? { color: textColor } : {}),
                      ...(colMinWidth
                        ? { minWidth: `${Math.ceil(colMinWidth)}px` }
                        : {}),
                    };
                    const style =
                      Object.keys(cellStyle).length > 0 ? cellStyle : undefined;
                    const shouldRenderDatabar =
                      !!databarConfig?.type &&
                      !!metricKey &&
                      (cell || databarConfig.type === 'waterfall');
                    const cellContent = shouldRenderDatabar
                      ? renderDatabarContent(
                          row,
                          col,
                          cell,
                          metricKey,
                          d3FormatOverride,
                        )
                      : renderCellContent(
                          row,
                          col,
                          metricKey,
                          d3FormatOverride,
                        );
                    const cellInteractionProps = emitCrossFilters
                      ? {
                          onClick: () => handleCellClick(row, col),
                          onKeyDown: (
                            event: KeyboardEvent<HTMLTableCellElement>,
                          ) => handleCellKeyDown(event, row, col),
                          role: 'button' as const,
                          tabIndex: 0,
                        }
                      : {};
                    return (
                      <td
                        key={cellKey}
                        className={cellClassName}
                        style={style}
                        {...cellInteractionProps}
                        onContextMenu={event =>
                          handleCellContextMenu(event, row, col)
                        }
                      >
                        {cellContent}
                      </td>
                    );
                  })}
                </tr>
              );
            })}
          </tbody>
        </StyledTable>
      )}
    </Container>
  );
};
