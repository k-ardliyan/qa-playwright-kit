/** @jsxImportSource @kitajs/html */
export function AccordionToolbar() {
  return (
    <div
      class="accordion-toolbar view-toolbar--hidden"
      id="accordion-toolbar"
      data-toolbar-for="accordion"
      role="toolbar"
      aria-label="Accordion controls"
      hidden
      aria-hidden="true"
    >
      <span class="accordion-toolbar__label">Accordion</span>
      <select
        class="sort-select cmd-select"
        id="accordion-sort-select"
        aria-label="Sort accordion cards"
      >
        <option value="default">Default order</option>
        <option value="status-fail-first">Status (fail first)</option>
        <option value="priority-high-first">Priority (high first)</option>
        <option value="duration-desc">Duration (longest first)</option>
      </select>
    </div>
  );
}
