/**
 * Stage handlers barrel — Native Semantic Engine
 *
 * Each stage handler is a pure function of (StageContext, input). The
 * WorkflowController facade owns state + persistence; these own the stage
 * logic. Import this barrel from the controller to keep the dispatch table
 * readable.
 *
 * @module agents/integration/stages
 */

export {
  STAGE_ORDER,
  nextStageAfter,
  firstUnusableStageBefore,
  ensureWorkflow,
  type StageContext,
  type StageResult,
  type StageInput,
} from './context';
export { runExploreStage } from './explore';
export { runModelStage } from './model';
export { runChallengeStage } from './challenge';
export { runGenerateStage } from './generate';
export { runValidateStage } from './validate';
