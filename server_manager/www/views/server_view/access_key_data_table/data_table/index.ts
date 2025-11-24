/**
 * Copyright 2025 The Outline Authors
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import {css, html, LitElement, TemplateResult, nothing} from 'lit';
import {customElement, property} from 'lit/decorators.js';

import '@material/mwc-icon';
import '../../icon_tooltip';

const INTERNAL_LIT_ENUM_HTML_RESULT = 1;

/**
 * A function that compares two values of type T and returns a number indicating their relative order.
 *
 * @template T The type of the values being compared.
 * @param {T} value1 The first value to compare.
 * @param {T} value2 The second value to compare.
 * @returns {-1 | 0 | 1} A negative number if value1 is less than value2, zero if they are equal, or a positive number if value1 is greater than value2.
 */
export type Comparator<T> = (
  value1: T,
  value2: T,
  language?: string
) => -1 | 0 | 1;

function _clamp(number: number): 1 | 0 | -1 {
  if (number <= -1) return -1;
  if (number >= 1) return 1;
  return 0;
}

/**
 * A default comparator function for numerical data.
 *
 * @param {number} value1 The first numerical value.
 * @param {number} value2 The second numerical value.
 * @returns {-1 | 0 | 1}  -1 if value1 < value2, 0 if value1 === value2, 1 if value1 > value2.
 */
export const defaultNumericComparator: Comparator<number> = (
  value1: number,
  value2: number
): -1 | 0 | 1 => {
  return _clamp(value1 - value2);
};

/**
 * A default comparator function for strings.
 *
 * @param {number} value1 The first string.
 * @param {number} value2 The second string.
 * @param {string} language The locale to compare the strings in
 * @returns {-1 | 0 | 1}  -1 if value1 < value2, 0 if value1 === value2, 1 if value1 > value2.
 */
export const defaultStringComparator: Comparator<string> = (
  value1: string,
  value2: string,
  language: string = 'en'
) => _clamp(value1.localeCompare(value2, language));

/**
 * A default comparator for Dates.
 * @param {Date} value1 The first date.
 * @param {Date} value2 The second date.
 * @returns {-1 | 0 | 1}  -1 if value1 < value2, 0 if value1 === value2, 1 if value1 > value2.
 */
export const defaultDateComparator: Comparator<Date> = (
  value1: Date,
  value2: Date
) => {
  return _clamp(value1.getTime() - value2.getTime());
};

/**
 * Enum representing the sort direction of a DataTable column.
 */
export enum DataTableSortDirection {
  ASCENDING = 'ascending',
  DESCENDING = 'descending',
  NONE = 'none',
}

/**
 * Events that the data table can emit.
 */
export enum DataTableEvent {
  SORT = 'DataTable.Sort',
}

/**
 * Properties describing a column in a DataTable.
 *
 * @template T The type of data represented in the column.
 */
export interface DataTableColumnProperties<T> {
  displayName?: string | TemplateResult<typeof INTERNAL_LIT_ENUM_HTML_RESULT>;
  comparator?: Comparator<T>;
  id: string;
  render: (_value: T) => TemplateResult<typeof INTERNAL_LIT_ENUM_HTML_RESULT>;
  tooltip?: string;
}

// TODO(#2384): this table is meant to collapse when a certain container size is reached, but
// our current version of Electron doesn't support it. Add a container query once
// electron is upgraded.

@customElement('data-table')
export class DataTable<T extends object> extends LitElement {
  @property({type: Array}) columns: DataTableColumnProperties<T>[];
  @property({type: Array}) data: T[];

  @property({type: String}) sortColumnId?: string;
  @property({type: String}) sortDirection: DataTableSortDirection =
    DataTableSortDirection.NONE;

  static styles = css`
    :host {
      --data-table-background-color: hsl(197, 13%, 22%);
      --data-table-text-color: hsl(0, 0%, 79%);
      --data-table-font-family: 'Inter', system-ui;
      --data-table-font-size: 0.8rem;

      --data-table-cell-padding: 0.8rem;
      --data-table-cell-gap: 0.35rem;
      --data-table-sides-padding: 1.5rem;

      --data-table-header-icon-size: 1rem;
      --data-table-header-border-bottom: 0.7rem solid hsla(200, 16%, 19%, 1);

      --data-table-row-border-bottom: 1px solid hsla(0, 0%, 100%, 0.2);

      --data-table-collapsed-vertical-padding: 1.5rem;
      --data-table-collapsed-row-label-font-size: 0.7rem;
      --data-table-collapsed-row-label-icon-size: 1rem;
      --data-table-collapsed-row-label-icon-button-size: 1.35rem;
      --data-table-collapsed-row-label-gap: 0.25rem;
    }

    table,
    thead,
    tbody,
    tr,
    td,
    th {
      all: initial;
    }

    thead,
    tbody,
    tr {
      display: contents;
    }

    table {
      background-color: var(--data-table-background-color);
      display: grid;
      grid-template-columns: repeat(var(--data-table-columns), auto);
      isolation: isolate;
    }

    th,
    td {
      box-sizing: border-box;
      color: var(--data-table-text-color);
      background-color: var(--data-table-background-color);
      display: flex;
      font-family: var(--data-table-font-family);
      gap: var(--data-table-cell-gap);
      padding: var(--data-table-cell-padding);
      font-size: var(--data-table-font-size);
    }

    th {
      align-items: center;
      border-bottom: var(--data-table-header-border-bottom);
      cursor: pointer;
      position: sticky;
      top: 0;

      /* ensure the header covers content when it sticks */
      z-index: 1;

      --mdc-icon-size: var(--data-table-header-icon-size);
    }

    th > icon-tooltip {
      --icon-tooltip-icon-size: var(--data-table-header-icon-size);
      --icon-tooltip-button-size: 1.6rem;
    }

    th > mwc-icon {
      --mdc-icon-size: var(--data-table-header-icon-size);
    }

    th:first-child {
      padding-left: calc(
        var(--data-table-cell-padding) + var(--data-table-sides-padding)
      );
    }

    :host([dir='rtl']) th:first-child {
      padding-left: 0;
      padding-right: calc(
        var(--data-table-cell-padding) + var(--data-table-sides-padding)
      );
    }

    th:last-child {
      padding-right: calc(
        var(--data-table-cell-padding) + var(--data-table-sides-padding)
      );
    }

    :host([dir='rtl']) th:last-child {
      padding-right: 0;
      padding-left: calc(
        var(--data-table-cell-padding) + var(--data-table-sides-padding)
      );
    }

    td {
      border-bottom: var(--data-table-row-border-bottom);
      flex-direction: column;
      justify-content: center;
    }

    td:first-child {
      margin-left: var(--data-table-sides-padding);
    }

    :host([dir='rtl']) td:first-child {
      margin-left: 0;
      margin-right: var(--data-table-sides-padding);
    }

    td:last-child {
      margin-right: var(--data-table-sides-padding);
    }

    :host([dir='rtl']) td:last-child {
      margin-right: 0;
      margin-left: var(--data-table-sides-padding);
    }

    label {
      align-items: center;
      display: none;
      font-size: var(--data-table-row-label-font-size);
      gap: var(--data-table-collapsed-row-label-gap);
      text-transform: uppercase;
    }

    label > icon-tooltip {
      --icon-tooltip-icon-size: var(--data-table-collapsed-row-label-icon-size);
      --icon-tooltip-button-size: var(
        --data-table-collapsed-row-label-icon-button-size
      );
    }

    /*
      TODO (#2384): 
        This max-width value is currently entirely dependent on the contents of the window from which the 
        table is rendered. Convert this to a container query once we upgrade electron so it's reusable.
    */
    @media (max-width: 900px) {
      table {
        grid-template-columns: auto;
      }

      th {
        display: none;
      }

      td {
        border: none;
      }

      td:first-child,
      td:last-child,
      :host([dir='rtl']) td:first-child,
      :host([dir='rtl']) td:last-child {
        margin: 0;
      }

      td:first-child {
        padding-top: var(--data-table-collapsed-vertical-padding);
      }

      td:last-child {
        padding-bottom: var(--data-table-collapsed-vertical-padding);
        border-bottom: var(--data-table-row-border-bottom);
      }

      label {
        display: flex;
      }
    }
  `;

  render() {
    return html`
      <table style="--data-table-columns: ${this.columns.length};">
        <thead>
          <tr>
            ${this.columns.map(column => this.renderHeaderCell(column))}
          </tr>
        </thead>
        <tbody>
          ${this.sortedData.map(row => {
            return html`<tr>
              ${this.columns.map(column => this.renderDataCell(column, row))}
            </tr>`;
          })}
        </tbody>
      </table>
    `;
  }

  renderHeaderCell(columnProperties: DataTableColumnProperties<T>) {
    let sortIcon;

    switch (this.sortDirection) {
      case DataTableSortDirection.ASCENDING:
        sortIcon = html`<mwc-icon>arrow_upward</mwc-icon>`;
        break;
      case DataTableSortDirection.DESCENDING:
        sortIcon = html`<mwc-icon>arrow_downward</mwc-icon>`;
        break;
      case DataTableSortDirection.NONE:
      default:
        sortIcon = nothing;
    }

    return html`<th @click=${() => this.sort(columnProperties)}>
      <span class="header-display-name"
        >${columnProperties?.displayName ?? nothing}</span
      >
      ${columnProperties?.tooltip
        ? html`<icon-tooltip text="${columnProperties.tooltip}"></icon-tooltip>`
        : nothing}
      ${this.sortColumnId === columnProperties.id ? sortIcon : nothing}
    </th>`;
  }

  renderDataCell(columnProperties: DataTableColumnProperties<T>, row: T) {
    return html`<td>
      <label
        >${columnProperties?.displayName ?? nothing}${columnProperties?.tooltip
          ? html`<icon-tooltip text=${columnProperties.tooltip}></icon-tooltip>`
          : nothing}</label
      >
      <span class="data-value">${columnProperties.render(row)}</span>
    </td>`;
  }

  sort(columnProperties: DataTableColumnProperties<T>) {
    if (!columnProperties.comparator) {
      return;
    }

    if (this.sortColumnId && columnProperties.id !== this.sortColumnId) {
      return this.dispatchEvent(
        new CustomEvent(DataTableEvent.SORT, {
          detail: {
            columnId: columnProperties.id,
            sortDirection:
              this.sortDirection === DataTableSortDirection.NONE
                ? DataTableSortDirection.ASCENDING
                : this.sortDirection,
          },
          bubbles: true,
          composed: true,
        })
      );
    }

    let sortDirection;
    switch (this.sortDirection) {
      case DataTableSortDirection.ASCENDING:
        sortDirection = DataTableSortDirection.DESCENDING;
        break;
      case DataTableSortDirection.DESCENDING:
        sortDirection = DataTableSortDirection.NONE;
        break;
      case DataTableSortDirection.NONE:
      default:
        sortDirection = DataTableSortDirection.ASCENDING;
        break;
    }

    this.dispatchEvent(
      new CustomEvent(DataTableEvent.SORT, {
        detail: {
          columnId: columnProperties.id,
          sortDirection,
        },
        bubbles: true,
        composed: true,
      })
    );
  }

  private get sortedData() {
    if (
      !this.sortColumnId ||
      this.sortDirection === DataTableSortDirection.NONE
    ) {
      return this.data;
    }

    const comparator = this.columns.find(
      ({id}) => id === this.sortColumnId
    )?.comparator;

    if (!comparator) {
      return this.data;
    }

    return [...this.data].sort((row1, row2) => {
      if (this.sortDirection === DataTableSortDirection.DESCENDING) {
        return comparator(row2, row1);
      }

      return comparator(row1, row2);
    });
  }
}
