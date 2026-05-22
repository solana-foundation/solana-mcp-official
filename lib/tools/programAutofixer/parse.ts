import path from "node:path";
import { Language, Parser, type Tree } from "web-tree-sitter";

let parserPromise: Promise<Parser> | null = null;

async function loadParser(): Promise<Parser> {
  await Parser.init();
  const rustGrammarDir = path.dirname(require.resolve("tree-sitter-rust/package.json"));
  const rustWasmPath = path.join(rustGrammarDir, "tree-sitter-rust.wasm");
  const language = await Language.load(rustWasmPath);
  const parser = new Parser();
  parser.setLanguage(language);
  return parser;
}

export async function getParser(): Promise<Parser> {
  if (!parserPromise) parserPromise = loadParser();
  return parserPromise;
}

export async function parseRust(source: string): Promise<Tree> {
  const parser = await getParser();
  const tree = parser.parse(source);
  if (!tree) throw new Error("tree-sitter failed to produce a parse tree for the input source");
  return tree;
}
