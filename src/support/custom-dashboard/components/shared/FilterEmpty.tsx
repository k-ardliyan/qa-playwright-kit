/** @jsxImportSource @kitajs/html */

/** Shown when filters hide every row. Hidden until the filter engine flips it. */
export function FilterEmpty() {
  return (
    <div class="filter-empty" id="filter-empty" hidden aria-hidden="true" role="status">
      <p class="filter-empty__title">No tests match these filters</p>
      <p class="filter-empty__copy">
        Clear search, status, module, or feature to bring the list back.
      </p>
      <button type="button" class="btn btn--ghost" id="filter-empty-reset">
        Clear filters
      </button>
    </div>
  );
}
