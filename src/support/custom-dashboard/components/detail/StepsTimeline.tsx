/** @jsxImportSource @kitajs/html */
/** @jsxImportSource @kitajs/html */
import type { CollectedStep, StepSnippet } from '../../types';
import { formatDuration } from '../../shared';
import { stripAnsi } from '../../../reporter/collect';
import { tokenizeLine } from '../../code-highlight';
import { EmptyState } from '../shared/EmptyState';
import { IconCircleCheck, IconCircleX, IconCircleSlash2, IconSearch } from '../shared/icons';

export interface StepsTimelineProps {
  steps: CollectedStep[];
}

function StepStatusIcon({ status }: { status: string }) {
  const cls =
    status === 'passed'
      ? 'tree-item__status--passed'
      : status === 'failed'
        ? 'tree-item__status--failed'
        : 'tree-item__status--skipped';
  const icon =
    status === 'passed' ? (
      <IconCircleCheck size={12} />
    ) : status === 'failed' ? (
      <IconCircleX size={12} />
    ) : (
      <IconCircleSlash2 size={12} />
    );
  return (
    <span class={`tree-item__status ${cls}`} aria-hidden="true">
      {icon}
    </span>
  );
}

function stepHasFailedDescendant(step: CollectedStep): boolean {
  if (step.status === 'failed') return true;
  return step.steps.some(stepHasFailedDescendant);
}

/**
 * Playwright propagates a failed child step's error up through every wrapping
 * test.step, so the same TimeoutError would render once per nesting level. A
 * step whose message is identical to some descendant's is noise — the deepest
 * failing step shows the block right at the failing action.
 */
function errorDuplicatedInDescendants(step: CollectedStep): boolean {
  const message = (step.errorMessage || '').trim();
  if (!message) return false;
  const walk = (list: CollectedStep[]): boolean =>
    list.some(
      (s) => (s.errorMessage || '').trim() === message || (s.steps.length > 0 && walk(s.steps)),
    );
  return walk(step.steps);
}

/** Longest step in the tree — the scale for every duration bar. */
function maxDuration(steps: CollectedStep[]): number {
  let max = 0;
  const walk = (list: CollectedStep[]): void => {
    for (const s of list) {
      if (s.duration > max) max = s.duration;
      if (s.steps.length) walk(s.steps);
    }
  };
  walk(steps);
  return max;
}

/**
 * A step's share of the slowest step, as a percentage. The bar carries the
 * relative cost at a glance; the exact figure stays in the label beside it, so
 * the bar never has to be read to the pixel.
 */
function DurationBar({ duration, max, tone }: { duration: number; max: number; tone: string }) {
  if (max <= 0) return null;
  const pct = Math.max(1, Math.round((duration / max) * 100));
  return (
    <span class={`step-bar step-bar--${tone}`} aria-hidden="true">
      <span class="step-bar__fill" style={`--w:${pct}%`} />
    </span>
  );
}

function StepErrorBlock({ step }: { step: CollectedStep }) {
  if (!step.errorMessage) return null;
  if (errorDuplicatedInDescendants(step)) return null;
  return (
    <div class="test-error-container">
      <pre class="test-error-view error-block step-error" safe>
        {stripAnsi(step.errorMessage)}
      </pre>
    </div>
  );
}

/**
 * Source window around the step, styled like the built-in report: a line-number
 * gutter, the executed line marked, and a caret under the column. Rendered only
 * when the reporter captured a snippet for this step.
 */
function CodePeek({ snippet }: { snippet: StepSnippet }) {
  return (
    <div class="step-snippet">
      <pre class="step-snippet__code">
        {snippet.lines.map((line, i) => {
          const n = snippet.startLine + i;
          const highlighted = n === snippet.highlightLine;
          return (
            <span class={`step-snippet__line${highlighted ? ' is-highlight' : ''}`}>
              <span class="step-snippet__ln" aria-hidden="true">
                {n}
              </span>
              <span class="step-snippet__src">
                {tokenizeLine(line).map((token) =>
                  token.type === 'plain' ? (
                    <span safe>{token.text}</span>
                  ) : (
                    // `tok` is the hook every token carries; `tok--<type>` is the
                    // colour. Consumers select `.tok` and read the type off it.
                    <span class={`tok tok--${token.type}`} safe>
                      {token.text}
                    </span>
                  ),
                )}
              </span>{' '}
            </span>
          );
        })}
      </pre>
    </div>
  );
}

function StepTitleRow({
  step,
  indentPx,
  hasChildren,
  max,
}: {
  step: CollectedStep;
  indentPx: number;
  hasChildren: boolean;
  max: number;
}) {
  const tone = step.status === 'failed' ? 'failed' : 'passed';
  return (
    <div class="tree-item__title" style={`padding-left:${indentPx}px`}>
      {!hasChildren && <span class="tree-item__spacer" aria-hidden="true" />}
      <StepStatusIcon status={step.status} />
      <span class="tree-item__label" safe>
        {step.title}
      </span>
      {step.subtitle ? (
        <span class="tree-item__subtitle" safe>
          {step.subtitle}
        </span>
      ) : null}
      <DurationBar duration={step.duration} max={max} tone={tone} />
      {/* `safe` because formatDuration returns a controlled "123ms"/"1.50s"
          string built from a number — never user input. */}
      <span class="tree-item__duration" safe>
        {formatDuration(step.duration)}
      </span>
    </div>
  );
}

function StepTree({
  steps,
  level = 0,
  max,
}: {
  steps: CollectedStep[];
  level?: number;
  max: number;
}) {
  if (steps.length === 0) return null;

  return (
    <>
      {steps.map((step) => {
        const failed = step.status === 'failed';
        const hasChildren = step.steps.length > 0;
        const indentPx = 4 + level * 22;
        const titleAttr = (step.title || '').toLowerCase();
        const shouldOpen = failed || stepHasFailedDescendant(step);

        if (!hasChildren) {
          return (
            <div
              class={`tree-item${failed ? ' tree-item--failed' : ''}`}
              role="treeitem"
              data-step-title={titleAttr}
            >
              <StepTitleRow step={step} indentPx={indentPx} hasChildren={hasChildren} max={max} />
              {step.snippet ? <CodePeek snippet={step.snippet} /> : null}
              <StepErrorBlock step={step} />
              {step.params && Object.keys(step.params).length > 0 ? (
                <div class="step-params-strip" style={`padding-left:${indentPx + 24}px`}>
                  {Object.entries(step.params).map(([k, v]) => (
                    <span class="step-param-tag">
                      <span class="param-k" safe>
                        {k}
                      </span>
                      :{' '}
                      <span class="param-v" safe>
                        {String(v)}
                      </span>
                    </span>
                  ))}
                </div>
              ) : null}
            </div>
          );
        }

        return (
          <details
            class={`tree-item tree-item--branch${failed ? ' tree-item--failed' : ''}`}
            role="treeitem"
            data-step-title={titleAttr}
            open={shouldOpen}
          >
            <summary class="tree-item__title" style={`padding-left:${indentPx}px`}>
              <StepStatusIcon status={step.status} />
              <span class="tree-item__label" safe>
                {step.title}
              </span>
              {step.subtitle ? (
                <span class="tree-item__subtitle" safe>
                  {step.subtitle}
                </span>
              ) : null}
              <DurationBar duration={step.duration} max={max} tone={failed ? 'failed' : 'passed'} />
              <span class="tree-item__duration" safe>
                {formatDuration(step.duration)}
              </span>
            </summary>
            <div class="tree-item__body">
              {step.snippet ? <CodePeek snippet={step.snippet} /> : null}
              <StepErrorBlock step={step} />
              <div class="tree-item__children" role="group">
                <StepTree steps={step.steps} level={level + 1} max={max} />
              </div>
            </div>
          </details>
        );
      })}
    </>
  );
}

export function StepsTimeline({ steps }: StepsTimelineProps) {
  if (steps.length === 0) {
    return <EmptyState message="No recorded test steps." />;
  }

  const max = maxDuration(steps);

  return (
    <div class="steps-panel" data-steps-panel="">
      <form class="step-filter" role="search" onsubmit="return false">
        <span class="step-filter__icon" aria-hidden="true">
          <IconSearch size={14} />
        </span>
        <input
          type="search"
          class="step-filter__input"
          data-step-filter=""
          placeholder="Filter steps in this test…"
          aria-label="Filter steps in this test"
          autocomplete="off"
          spellcheck="false"
        />
      </form>
      <div class="steps-tree" role="tree">
        <StepTree steps={steps} max={max} />
      </div>
      <p class="step-filter-empty" data-step-filter-empty="" hidden>
        No steps match the filter.
      </p>
    </div>
  );
}
