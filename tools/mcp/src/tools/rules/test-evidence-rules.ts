import ts from 'typescript';
import type { ValidationViolation } from './rule-helpers';
import { isTraceabilityExempt } from './rule-helpers';

const API_METHODS = new Set(['get', 'post', 'put', 'patch', 'delete', 'fetch']);
const OFFICIAL_API_HELPERS = new Set(['apiSeed', 'apiCleanup', 'apiJson']);

function propertyName(node: ts.Expression): string | undefined {
  return ts.isPropertyAccessExpression(node) ? node.name.text : undefined;
}

function importedApiHelpers(sourceFile: ts.SourceFile): Set<string> {
  const imported = new Set<string>();
  for (const statement of sourceFile.statements) {
    if (!ts.isImportDeclaration(statement) || !ts.isStringLiteral(statement.moduleSpecifier))
      continue;
    if (statement.moduleSpecifier.text !== '@/support/pw') continue;
    const bindings = statement.importClause?.namedBindings;
    if (!bindings || !ts.isNamedImports(bindings)) continue;
    for (const element of bindings.elements) {
      if (OFFICIAL_API_HELPERS.has(element.name.text)) imported.add(element.name.text);
    }
  }
  return imported;
}

function isHybridTest(node: ts.CallExpression, sourceFile: ts.SourceFile): boolean {
  const title = node.arguments[0];
  if (title && (ts.isStringLiteralLike(title) || ts.isNoSubstitutionTemplateLiteral(title))) {
    if (/@hybrid\b/.test(title.text)) return true;
  }

  let parent: ts.Node | undefined = node.parent;
  while (parent) {
    if (ts.isCallExpression(parent)) {
      const callee = parent.expression;
      if (
        ts.isPropertyAccessExpression(callee) &&
        callee.name.text === 'describe' &&
        ts.isIdentifier(callee.expression) &&
        callee.expression.text === 'test' &&
        parent.arguments[1] &&
        /@hybrid\b/.test(parent.arguments[1].getText(sourceFile))
      ) {
        return true;
      }
    }
    parent = parent.parent;
  }
  return false;
}

function enclosingTest(node: ts.Node): ts.CallExpression | undefined {
  let parent: ts.Node | undefined = node.parent;
  while (parent) {
    if (ts.isCallExpression(parent)) {
      const callee = parent.expression;
      if (
        ts.isIdentifier(callee) &&
        callee.text === 'test' &&
        parent.arguments.length >= 2 &&
        ts.isFunctionLike(parent.arguments[1])
      )
        return parent;
      if (
        ts.isPropertyAccessExpression(callee) &&
        ts.isIdentifier(callee.expression) &&
        callee.expression.text === 'test' &&
        ['only', 'fail', 'slow'].includes(callee.name.text) &&
        parent.arguments.length >= 2 &&
        ts.isFunctionLike(parent.arguments[1])
      )
        return parent;
    }
    parent = parent.parent;
  }
  return undefined;
}

function testHasUiActionAndAssertion(
  testCall: ts.CallExpression,
  sourceFile: ts.SourceFile,
): boolean {
  const body = testCall.arguments[1];
  if (!body || !ts.isFunctionLike(body)) return false;
  let hasUiAction = false;
  let hasUiAssertion = false;
  const locatorVariables = new Set<string>();
  const findLocators = (node: ts.Node): void => {
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.initializer) {
      const value = node.initializer.getText(sourceFile);
      if (
        /\bpage\.(?:locator|getByRole|getByLabel|getByText|getByTestId|getByPlaceholder)\s*\(/.test(
          value,
        )
      ) {
        locatorVariables.add(node.name.text);
      }
    }
    ts.forEachChild(node, findLocators);
  };
  findLocators(body);

  const isUiLocator = (expression: ts.Expression): boolean => {
    const text = expression.getText(sourceFile);
    return (
      /\bpage\.(?:locator|getByRole|getByLabel|getByText|getByTestId|getByPlaceholder|url|title)\s*\(/.test(
        text,
      ) ||
      (ts.isIdentifier(expression) && locatorVariables.has(expression.text))
    );
  };

  const visit = (node: ts.Node): void => {
    if (ts.isCallExpression(node)) {
      const callee = node.expression;
      if (ts.isPropertyAccessExpression(callee)) {
        const action = callee.name.text;
        const receiver = callee.expression.getText(sourceFile);
        const usesPage =
          /\bpage\b/.test(receiver) ||
          [...locatorVariables].some((name) => new RegExp(`\\b${name}\\b`).test(receiver));
        if (
          usesPage &&
          ['goto', 'click', 'fill', 'check', 'uncheck', 'selectOption', 'press', 'type'].includes(
            action,
          )
        ) {
          hasUiAction = true;
        }
      }
      if (
        ts.isIdentifier(callee) &&
        callee.text === 'expect' &&
        node.arguments[0] &&
        isUiLocator(node.arguments[0])
      ) {
        hasUiAssertion = true;
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(body);
  return hasUiAction && hasUiAssertion;
}

function isRawApiCall(node: ts.CallExpression): boolean {
  const callee = node.expression;
  if (ts.isIdentifier(callee) && ['fetch', 'axios', 'request'].includes(callee.text)) return true;
  if (!ts.isPropertyAccessExpression(callee) || !API_METHODS.has(callee.name.text)) return false;
  const receiver = callee.expression;
  if (ts.isIdentifier(receiver) && (receiver.text === 'request' || receiver.text === 'fetch'))
    return true;
  return (
    ts.isPropertyAccessExpression(receiver) &&
    (receiver.name.text === 'request' || receiver.name.text === 'fetch')
  );
}

function importedNetworkClients(sourceFile: ts.SourceFile): Set<string> {
  const clients = new Set<string>();
  for (const statement of sourceFile.statements) {
    if (!ts.isImportDeclaration(statement) || !ts.isStringLiteral(statement.moduleSpecifier))
      continue;
    const moduleName = statement.moduleSpecifier.text;
    if (
      !['axios', 'got', 'superagent', 'node:http', 'node:https', 'http', 'https'].includes(
        moduleName,
      )
    )
      continue;
    const clause = statement.importClause;
    if (clause?.name) clients.add(clause.name.text);
    if (clause?.namedBindings && ts.isNamedImports(clause.namedBindings)) {
      for (const element of clause.namedBindings.elements) clients.add(element.name.text);
    }
  }
  return clients;
}

function isImportedNetworkCall(node: ts.CallExpression, clients: Set<string>): boolean {
  const callee = node.expression;
  if (!ts.isPropertyAccessExpression(callee) || !API_METHODS.has(callee.name.text)) return false;
  return ts.isIdentifier(callee.expression) && clients.has(callee.expression.text);
}

/**
 * Reading a session/auth state file from inside a spec.
 *
 * Detection is convention-based only — the `.auth/` directory (built by
 * `authStatePath`) or the helper itself. No app-specific token name is baked
 * in: a spec that extracts `token_anything` from an auth file is caught by the
 * path it reads, which is the framework's own portable convention.
 */
function isAuthFileRead(node: ts.CallExpression, sourceFile: ts.SourceFile): boolean {
  const callee = node.expression;
  const method = ts.isIdentifier(callee) ? callee.text : propertyName(callee as ts.Expression);
  if (!method || !/^(?:readFile|readFileSync|createReadStream)$/.test(method)) return false;
  return node.arguments.some((arg) => {
    const text = arg.getText(sourceFile);
    return /\.auth[\\/]/.test(text) || /\bauthStatePath\s*\(/.test(text);
  });
}

function uiLocatorVariables(testCall: ts.CallExpression, sourceFile: ts.SourceFile): Set<string> {
  const body = testCall.arguments[1];
  const variables = new Set<string>();
  if (!body || !ts.isFunctionLike(body)) return variables;
  const visit = (node: ts.Node): void => {
    if (
      ts.isVariableDeclaration(node) &&
      ts.isIdentifier(node.name) &&
      node.initializer &&
      /\bpage\.(?:locator|getByRole|getByLabel|getByText|getByTestId|getByPlaceholder)\s*\(/.test(
        node.initializer.getText(sourceFile),
      )
    ) {
      variables.add(node.name.text);
    }
    ts.forEachChild(node, visit);
  };
  visit(body);
  return variables;
}

function isObservedUiRead(
  expression: ts.Expression,
  sourceFile: ts.SourceFile,
  locatorVariables: Set<string>,
): boolean {
  let value = expression;
  if (ts.isAwaitExpression(value)) value = value.expression;
  const text = value.getText(sourceFile);
  if (/\bpage\.(?:url|title)\s*\(/.test(text)) return true;
  if (!ts.isCallExpression(value) || !ts.isPropertyAccessExpression(value.expression)) return false;
  const method = value.expression.name.text;
  if (!['innerText', 'textContent', 'inputValue', 'getAttribute'].includes(method)) return false;
  const receiver = value.expression.expression;
  const receiverText = receiver.getText(sourceFile);
  return (
    /\bpage\.(?:locator|getByRole|getByLabel|getByText|getByTestId|getByPlaceholder)\s*\(/.test(
      receiverText,
    ) ||
    (ts.isIdentifier(receiver) && locatorVariables.has(receiver.text))
  );
}

function observedUiVariables(testCall: ts.CallExpression, sourceFile: ts.SourceFile): Set<string> {
  const body = testCall.arguments[1];
  const variables = new Set<string>();
  if (!body || !ts.isFunctionLike(body)) return variables;
  const locatorVariables = uiLocatorVariables(testCall, sourceFile);
  const visit = (node: ts.Node): void => {
    if (
      ts.isVariableDeclaration(node) &&
      ts.isIdentifier(node.name) &&
      node.initializer &&
      isObservedUiRead(node.initializer, sourceFile, locatorVariables)
    ) {
      variables.add(node.name.text);
    }
    ts.forEachChild(node, visit);
  };
  visit(body);
  return variables;
}

function stringLiteral(node: ts.Expression | undefined): string | undefined {
  return node && (ts.isStringLiteralLike(node) || ts.isNoSubstitutionTemplateLiteral(node))
    ? node.text
    : undefined;
}

function metadataValue(testCall: ts.CallExpression, key: string): string | undefined {
  const body = testCall.arguments[1];
  if (!body || !ts.isFunctionLike(body)) return undefined;
  let expected: string | undefined;
  const visit = (node: ts.Node): void => {
    if (
      ts.isCallExpression(node) &&
      ts.isIdentifier(node.expression) &&
      node.expression.text === 'setTestMetadata'
    ) {
      const arg = node.arguments[0];
      if (arg && ts.isObjectLiteralExpression(arg)) {
        for (const property of arg.properties) {
          if (!ts.isPropertyAssignment(property)) continue;
          if (property.name.getText().replace(/["']/g, '') === key) {
            expected = stringLiteral(property.initializer);
          }
        }
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(body);
  return expected;
}

function lineAt(node: ts.Node, sourceFile: ts.SourceFile): number {
  return sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile)).line + 1;
}

/** Enforces the declared boundary between browser E2E and API-assisted setup. */
export function validateTestEvidenceBoundary(
  content: string,
  filePath: string,
  relativePath: string,
): ValidationViolation[] {
  if (isTraceabilityExempt(relativePath)) return [];

  const sourceFile = ts.createSourceFile(
    filePath,
    content,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS,
  );
  const helpers = importedApiHelpers(sourceFile);
  const networkClients = importedNetworkClients(sourceFile);
  const violations: ValidationViolation[] = [];
  const checkedTests = new Set<ts.CallExpression>();

  const add = (node: ts.Node, ruleName: string): void => {
    violations.push({
      filePath,
      lineNumber: lineAt(node, sourceFile),
      ruleName,
      severity: 'error',
    });
  };

  const visit = (node: ts.Node): void => {
    if (ts.isCallExpression(node)) {
      const testCall = enclosingTest(node);
      if (isRawApiCall(node) || isImportedNetworkCall(node, networkClients)) {
        add(
          node,
          'Evidence boundary: raw fetch/request calls are forbidden in generated browser specs; use declared hybrid helpers for setup, or @network-assert to observe a UI-triggered request.',
        );
        if (testCall && !checkedTests.has(testCall)) {
          checkedTests.add(testCall);
          if (
            !isHybridTest(testCall, sourceFile) ||
            metadataValue(testCall, 'evidenceMode') !== 'hybrid-ui'
          ) {
            add(
              testCall,
              "Evidence boundary: API-assisted behavior requires @hybrid and setTestMetadata({ evidenceMode: 'hybrid-ui' }); ordinary UI E2E must exercise behavior through the browser.",
            );
          } else if (!testHasUiActionAndAssertion(testCall, sourceFile)) {
            add(
              testCall,
              'Evidence boundary: @hybrid must still perform a browser UI action and assert a user-visible UI result in the same test.',
            );
          }
        }
      }

      if (isAuthFileRead(node, sourceFile)) {
        add(
          node,
          'Auth boundary: specs must not read .auth files or extract session tokens; use the registered storageState fixture.',
        );
      }

      if (ts.isIdentifier(node.expression) && node.expression.text === 'captureActualResult') {
        const testCall = enclosingTest(node);
        const actual = stringLiteral(node.arguments[0]);
        const expected = testCall ? metadataValue(testCall, 'expectedResult') : undefined;
        const actualIsExpected = actual && expected && actual.trim() === expected.trim();
        const actualExpression = node.arguments[0];
        const actualUsesExpected =
          actualExpression && /\bexpectedResult\b/.test(actualExpression.getText(sourceFile));
        const observedVars = testCall
          ? observedUiVariables(testCall, sourceFile)
          : new Set<string>();
        const locatorVars = testCall ? uiLocatorVariables(testCall, sourceFile) : new Set<string>();
        const actualObserved =
          actualExpression &&
          (isObservedUiRead(actualExpression, sourceFile, locatorVars) ||
            (ts.isIdentifier(actualExpression) && observedVars.has(actualExpression.text)));
        if (actualIsExpected || actualUsesExpected || !actualObserved) {
          add(
            node,
            'Evidence boundary: captureActualResult must use a value read from the UI (text, input value, URL, or title); copied or hand-written prose is not independent actual evidence.',
          );
        }
      }

      if (ts.isIdentifier(node.expression) && OFFICIAL_API_HELPERS.has(node.expression.text)) {
        const helper = node.expression.text;
        if (!helpers.has(helper)) {
          add(node, `Evidence boundary: ${helper} must be imported from @/support/pw.`);
        }
        const declaredMode = testCall ? metadataValue(testCall, 'evidenceMode') : undefined;
        if (!testCall || !isHybridTest(testCall, sourceFile) || declaredMode !== 'hybrid-ui') {
          add(
            node,
            `Evidence boundary: ${helper} requires @hybrid and setTestMetadata({ evidenceMode: 'hybrid-ui' }) in the same test.`,
          );
        } else if (!testHasUiActionAndAssertion(testCall, sourceFile)) {
          add(
            testCall,
            'Evidence boundary: @hybrid must still perform a browser UI action and assert a user-visible UI result in the same test.',
          );
        }
        if (helper === 'apiJson') {
          const method = node.arguments[1];
          const methodText =
            method && (ts.isStringLiteralLike(method) ? method.text.toUpperCase() : '');
          if (methodText !== 'GET')
            add(
              node,
              'Evidence boundary: apiJson is supplementary read-only evidence in @hybrid tests; use apiSeed/apiCleanup for test-owned setup and cleanup.',
            );
        }
        if (helper === 'apiCleanup') {
          const target = node.arguments[1];
          const targetText = target?.getText(sourceFile) ?? '';
          if (
            !target ||
            !ts.isTemplateExpression(target) ||
            !/\$\{[^}]*\b(?:id|_id)\b/.test(targetText)
          ) {
            add(
              node,
              'Cleanup boundary: apiCleanup must target a resource ID created by this test, not a collection, prefix, or shared-data sweep.',
            );
          }
        }
      }
    }
    ts.forEachChild(node, visit);
  };

  visit(sourceFile);
  return violations;
}

/** True when a test body materializes seed data (fixture or runtime helper). */
function testUsesSeededData(testCall: ts.CallExpression, sourceFile: ts.SourceFile): boolean {
  const body = testCall.arguments[1];
  if (!body || !ts.isFunctionLike(body)) return false;
  let uses = false;
  const visit = (node: ts.Node): void => {
    if (ts.isCallExpression(node)) {
      const callee = node.expression;
      if (ts.isIdentifier(callee) && callee.text === 'withSeededData') uses = true;
    }
    ts.forEachChild(node, visit);
  };
  visit(body);
  // The `seeded` fixture is a destructured parameter, not a call: look at the
  // test's own parameter list for `{ seeded }`.
  const params = body.parameters[0];
  if (params && ts.isParameter(params) && ts.isObjectBindingPattern(params.name)) {
    for (const element of params.name.elements) {
      if (ts.isIdentifier(element.name) && element.name.text === 'seeded') uses = true;
    }
  }
  return uses;
}

/** Seed refs declared in a test's setTestMetadata inputData / dataSetup. */
function declaredSeedRefs(testCall: ts.CallExpression, sourceFile: ts.SourceFile): string[] {
  const body = testCall.arguments[1];
  if (!body || !ts.isFunctionLike(body)) return [];
  const refs: string[] = [];
  const visit = (node: ts.Node): void => {
    if (
      ts.isCallExpression(node) &&
      ts.isIdentifier(node.expression) &&
      node.expression.text === 'setTestMetadata'
    ) {
      const text = node.arguments[0]?.getText(sourceFile) ?? '';
      for (const match of text.matchAll(/\bseed:\s*([a-z][\w.-]*)/gi)) {
        if (!refs.includes(match[1])) refs.push(match[1]);
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(body);
  return refs;
}

/**
 * Seed consistency: a test that declares a `seed:` ref must actually build it,
 * and a test that builds seed data must declare what it needs. Without this a
 * spec can name a seed in metadata while faking the setup — the claim and the
 * behavior drift apart with nothing to catch it.
 */
export function validateSeedUsage(
  content: string,
  filePath: string,
  relativePath: string,
): ValidationViolation[] {
  if (isTraceabilityExempt(relativePath)) return [];

  const sourceFile = ts.createSourceFile(
    filePath,
    content,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS,
  );
  const violations: ValidationViolation[] = [];
  const add = (node: ts.Node, ruleName: string): void => {
    violations.push({
      filePath,
      lineNumber: lineAt(node, sourceFile),
      ruleName,
      severity: 'error',
    });
  };

  const visit = (node: ts.Node): void => {
    if (ts.isCallExpression(node)) {
      const testCall = enclosingTest(node);
      if (
        testCall &&
        ts.isIdentifier(node.expression) &&
        node.expression.text === 'setTestMetadata'
      ) {
        const declared = declaredSeedRefs(testCall, sourceFile);
        if (declared.length > 0 && !testUsesSeededData(testCall, sourceFile)) {
          add(
            testCall,
            `Seed rule: this test declares ${declared
              .map((ref) => `seed:${ref}`)
              .join(
                ', ',
              )} but never materializes it — call withSeededData(request, seedGraph, [...]) or use the "seeded" fixture so the record actually exists.`,
          );
        }
      }
    }
    ts.forEachChild(node, visit);
  };

  visit(sourceFile);
  return violations;
}
