import type Parser from "web-tree-sitter";
import type { TryFromBody } from "./visitors/_helpers.js";

type Node = Parser.SyntaxNode;

export type Severity = "critical" | "high" | "medium" | "low";

export type Framework = "pinocchio" | "anchor" | "unknown";

export interface Issue {
  severity: Severity;
  rule: string;
  title: string;
  location: string;
  description: string;
  suggestion: string;
  code_snippet?: string;
}

export interface AutofixerOutput {
  issues: Issue[];
  suggestions: string[];
  require_another_tool_call_after_fixing: boolean;
}

export interface VisitorContext {
  source: string;
  filename: string;
  framework: Framework;
  output: AutofixerOutput;
  /** Cached once per run by the driver. Populated before any enter handler fires. */
  tryFromBodies: TryFromBody[];
}

export type EnterHandler = (node: Node, ctx: VisitorContext) => void;

export interface Visitor {
  name: string;
  severity: Severity;
  appliesTo: Framework[];
  /** Optional pre-pass: cache state on ctx, scan for prerequisites, etc. */
  before?(tree: Parser.Tree, ctx: VisitorContext): void;
  /** Per-node-type handlers. Driver dispatches by node.type during a single tree walk. */
  enter?: Record<string, EnterHandler>;
  /** Optional finalize after the walk. */
  after?(ctx: VisitorContext): void;
}

export function formatLocation(filename: string, node: Node): string {
  return `${filename}:${node.startPosition.row + 1}:${node.startPosition.column + 1}`;
}

export function snippet(source: string, node: Node, maxChars = 240): string {
  const text = source.slice(node.startIndex, node.endIndex);
  return text.length <= maxChars ? text : `${text.slice(0, maxChars)}…`;
}
