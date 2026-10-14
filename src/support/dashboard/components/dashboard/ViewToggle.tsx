/** @jsxImportSource @kitajs/html */
export function ViewToggle() {
  return (
    <div class="view-toggle" role="tablist" aria-label="View mode">
      <button
        class="toggle-btn toggle-btn--active"
        role="tab"
        aria-selected="true"
        data-action="toggle-view"
        data-view="table"
        id="tab-table"
        aria-controls="view-table"
        type="button"
      >
        Table
      </button>
      <button
        class="toggle-btn"
        role="tab"
        aria-selected="false"
        data-action="toggle-view"
        data-view="accordion"
        id="tab-accordion"
        aria-controls="view-accordion"
        type="button"
      >
        Accordion
      </button>
    </div>
  );
}
