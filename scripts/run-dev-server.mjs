import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import ts from 'typescript';

const projectRoot = process.cwd();
const sourcePath = path.join(projectRoot, 'server.ts');
const tempDir = path.join(projectRoot, '.tmp');
const outputPath = path.join(tempDir, 'server.dev.mjs');

await mkdir(tempDir, { recursive: true });

const source = await readFile(sourcePath, 'utf8');
const transpiled = ts.transpileModule(source, {
  compilerOptions: {
    module: ts.ModuleKind.ESNext,
    target: ts.ScriptTarget.ES2022,
  },
  fileName: sourcePath,
});

await writeFile(outputPath, transpiled.outputText, 'utf8');
await import(pathToFileURL(outputPath).href);
