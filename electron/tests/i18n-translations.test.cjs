const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const test = require('node:test');
const ts = require('typescript');

const sourcePath = path.join(__dirname, '..', '..', 'src', 'i18n.ts');
const languages = ['en', 'de', 'fr', 'es', 'ru', 'it'];

function findObjectInitializer(sourceFile, variableName) {
  for (const statement of sourceFile.statements) {
    if (!ts.isVariableStatement(statement)) continue;
    for (const declaration of statement.declarationList.declarations) {
      if (ts.isIdentifier(declaration.name) && declaration.name.text === variableName) {
        const initializer = declaration.initializer;
        return initializer && ts.isSatisfiesExpression(initializer) ? initializer.expression : initializer;
      }
    }
  }
  throw new Error(`Translation object "${variableName}" was not found.`);
}

function readRecord(sourceFile, objectName) {
  const initializer = findObjectInitializer(sourceFile, objectName);
  assert.ok(initializer && ts.isObjectLiteralExpression(initializer));
  const records = new Map();
  for (const property of initializer.properties) {
    if (!ts.isPropertyAssignment(property) || !ts.isIdentifier(property.name)
      || !ts.isObjectLiteralExpression(property.initializer)) continue;
    records.set(property.name.text, new Map(property.initializer.properties
      .filter((entry) => ts.isPropertyAssignment(entry)
        && (ts.isStringLiteral(entry.name) || ts.isIdentifier(entry.name)))
      .map((entry) => [
        ts.isIdentifier(entry.name) ? entry.name.text : entry.name.text,
        entry.initializer.getText(sourceFile).slice(1, -1),
      ])));
  }
  return records;
}

function findUiKeys(sourceFile) {
  const keys = new Set();
  function visit(node) {
    if (ts.isCallExpression(node)
      && ts.isIdentifier(node.expression)
      && ['t', 'text', 'ui'].includes(node.expression.text)
      && node.arguments.length > 0
      && ts.isStringLiteral(node.arguments[0])) {
      keys.add(node.arguments[0].text);
    }
    ts.forEachChild(node, visit);
  }
  visit(sourceFile);
  return keys;
}

test('every added UI and dynamic message has a translation in each supported language', async () => {
  const source = await fs.readFile(sourcePath, 'utf8');
  const sourceFile = ts.createSourceFile(sourcePath, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);

  for (const objectName of ['addedUiTranslations', 'dynamicUiTemplates']) {
    const records = readRecord(sourceFile, objectName);
    const expectedKeys = new Set(languages.flatMap((language) => [...(records.get(language)?.keys() ?? [])]));
    for (const language of languages) {
      const translations = records.get(language);
      assert.ok(translations, `${objectName} is missing ${language}`);
      for (const key of expectedKeys) {
        assert.ok(translations.has(key), `${objectName}.${language} is missing "${key}"`);
        assert.ok(translations.get(key), `${objectName}.${language} has an empty translation for "${key}"`);
      }
    }
  }

  const completedRecords = readRecord(sourceFile, 'completeUiTranslations');
  for (const language of languages) {
    const translations = completedRecords.get(language);
    assert.ok(translations, `completeUiTranslations is missing ${language}`);
    for (const [key, value] of translations) {
      assert.ok(key && value, `completeUiTranslations.${language} has an empty translation`);
    }
  }
});

test('every statically used UI label is translated in each supported language', async () => {
  const appPath = path.join(__dirname, '..', '..', 'src', 'App.tsx');
  const appSource = await fs.readFile(appPath, 'utf8');
  const appFile = ts.createSourceFile(appPath, appSource, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const i18nPath = path.join(__dirname, '..', '..', 'src', 'i18n.ts');
  const i18nSource = await fs.readFile(i18nPath, 'utf8');
  const i18nFile = ts.createSourceFile(i18nPath, i18nSource, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const usedKeys = findUiKeys(appFile);
  const primaryRecords = readRecord(i18nFile, 'translations');
  const baseRecords = readRecord(i18nFile, 'uiTranslations');
  const addedRecords = readRecord(i18nFile, 'addedUiTranslations');
  const completeRecords = readRecord(i18nFile, 'completeUiTranslations');
  const missing = [];

  for (const language of languages) {
    const translatedKeys = new Set([
      ...(primaryRecords.get(language)?.keys() ?? []),
      ...(baseRecords.get(language)?.keys() ?? []),
      ...(addedRecords.get(language)?.keys() ?? []),
      ...(completeRecords.get(language)?.keys() ?? []),
    ]);
    for (const key of usedKeys) {
      if (!translatedKeys.has(key)) missing.push(`${language}: ${key}`);
    }
  }
  const missingKeys = [...new Set(missing.map((entry) => entry.slice(entry.indexOf(': ') + 2)))];
  assert.deepEqual(missing, [], `Missing UI translations (${missing.length}):\n${missingKeys.join('\n')}`);
});
