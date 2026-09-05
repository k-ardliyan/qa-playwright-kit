/** @jsxImportSource @kitajs/html */
import type { CollectedStep } from '../../types';
import { EmptyState } from '../shared/EmptyState';

export interface StepsTimelineProps {
  steps: CollectedStep[];
}

function StepStatusIcon({ status }: { status: string }) {
  const icon = status === 'passed' ? '✓' : status === 'failed' ? '✕' : '⊘';
  const cls =
    status === 'passed'
      ? 'tree-item__status--passed'
      : status === 'failed'
        ? 'tree-item__status--failed'
        : 'tree-item__status--skipped';
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

function StepErrorBlock({ step }: { step: CollectedStep }) {
  if (!step.errorMessage) return null;
  return (
    <div class="test-error-container">
      <pre class="test-error-view step-error" safe>
        {step.errorMessage}
      </pre>
    </div>
  );
}

function StepTitleRow({
  step,
  indentPx,
  hasChildren,
}: {
  step: CollectedStep;
  indentPx: number;
  hasChildren: boolean;
}) {
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
      <span class="tree-item__duration">{step.duration}ms</span>
    </div>
  );
}

function StepTree({ steps, level = 0 }: { steps: CollectedStep[]; level?: number }) {
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
              <StepTitleRow step={step} indentPx={indentPx} hasChildren={hasChildren} />
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
              <span class="tree-item__duration">{step.duration}ms</span>
            </summary>
            <div class="tree-item__body">
              <StepErrorBlock step={step} />
              <div class="tree-item__children" role="group">
                <StepTree steps={step.steps} level={level + 1} />
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

  return (
    <div class="steps-panel" data-steps-panel="">
      <form class="step-filter" role="search" onsubmit="return false">
        <span class="step-filter__icon" aria-hidden="true">
          ⌕
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
        <StepTree steps={steps} />
      </div>
      <p class="step-filter-empty" data-step-filter-empty="" hidden>
        No steps match the filter.
      </p>
    </div>
  );
}
