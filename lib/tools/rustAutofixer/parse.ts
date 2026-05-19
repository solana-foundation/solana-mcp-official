import path from "node:path";
import Parser from "web-tree-sitter";

let parserPromise: Promise<Parser> | null = null;

async function loadParser(): Promise<Parser> {
  await Parser.init();
  const wasmsDir = path.dirname(require.resolve("tree-sitter-wasms/package.json"));
  const rustWasmPath = path.join(wasmsDir, "out", "tree-sitter-rust.wasm");
  const language = await Parser.Language.load(rustWasmPath);
  const parser = new Parser();
  parser.setLanguage(language);
  return parser;
}

export async function getParser(): Promise<Parser> {
  if (!parserPromise) parserPromise = loadParser();
  return parserPromise;
}

export async function parseRust(source: string): Promise<Parser.Tree> {
  const parser = await getParser();
  const tree = parser.parse(source);
  if (!tree) throw new Error("tree-sitter failed to produce a parse tree for the input source");
  return tree;
}
