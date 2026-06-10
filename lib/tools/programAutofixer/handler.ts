import type { Node, Tree } from "web-tree-sitter";
import { parseRust } from "./parse.js";
import { walk } from "./walk.js";
import { allVisitors } from "./visitors/index.js";
import { findTryFromBodies } from "./visitors/_helpers.js";
import { collectAnchorContext } from "./visitors/_anchor-helpers.js";
import type { AutofixerOutput, EnterHandler, Framework, Issue, Visitor, VisitorContext } from "./types.js";

const PINOCCHIO_USE_ROOTS = new Set([
  "pinocchio",
  "pinocchio_log",
  "pinocchio_pubkey",
  "pinocchio_system",
  "pinocchio_token",
  "pinocchio_associated_token_account",
]);

const ANCHOR_USE_ROOTS = new Set(["anchor_lang", "anchor_spl"]);

function useDeclarationRoot(useDecl: Node): string | null {
  for (let i = 0; i < useDecl.namedChildCount; i++) {
    const child = useDecl.namedChild(i);
    if (!child) continue;
    if (child.type === "scoped_identifier" || child.type === "use_wildcard" || child.type === "scoped_use_list") {
      let cursor: Node | null = child;
      while (cursor) {
        if (cursor.type === "identifier") return cursor.text;
        if (cursor.type === "scoped_identifier") {
          const first = cursor.namedChild(0);
          if (first?.type === "identifier") return first.text;
          cursor = first;
          continue;
        }
        if (cursor.type === "use_wildcard" || cursor.type === "scoped_use_list") {
          cursor = cursor.namedChild(0);
          continue;
        }
        return null;
      }
    }
    if (child.type === "identifier") return child.text;
  }
  return null;
}

function detectFramework(tree: Tree): Framework {
  let pinocchio = false;
  let anchor = false;

  walk(tree.rootNode, node => {
    if (pinocchio && anchor) return "skip";

    if (node.type === "use_declaration") {
      const root = useDeclarationRoot(node);
      if (root && PINOCCHIO_USE_ROOTS.has(root)) pinocchio = true;
      if (root && ANCHOR_USE_ROOTS.has(root)) anchor = true;
      return "skip";
    }

    if (node.type === "attribute_item") {
      const attribute = node.namedChild(0);
      if (!attribute) return "skip";
      const head = attribute.namedChild(0);
      if (head?.type === "identifier") {
        if (head.text === "program") anchor = true;
        if (head.text === "derive") {
          for (let i = 0; i < attribute.namedChildCount; i++) {
            const sib = attribute.namedChild(i);
            if (!sib || sib.type !== "token_tree") continue;
            let foundAccounts = false;
            walk(sib, n => {
              if (foundAccounts) return "skip";
              if (n.type === "identifier" && n.text === "Accounts") foundAccounts = true;
            });
            if (foundAccounts) anchor = true;
          }
        }
      }
      return "skip";
    }
  });

  if (pinocchio) return "pinocchio";
  if (anchor) return "anchor";
  return "unknown";
}

function dedupe(issues: Issue[]): Issue[] {
  const seen = new Set<string>();
  const out: Issue[] = [];
  for (const issue of issues) {
    const key = `${issue.rule}|${issue.location}|${issue.title}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(issue);
  }
  return out;
}

function buildDispatch(visitors: readonly Visitor[]): Map<string, Array<{ visitor: Visitor; handler: EnterHandler }>> {
  const dispatch = new Map<string, Array<{ visitor: Visitor; handler: EnterHandler }>>();
  for (const v of visitors) {
    if (!v.enter) continue;
    for (const [type, handler] of Object.entries(v.enter)) {
      if (!handler) continue;
      let list = dispatch.get(type);
      if (!list) {
        list = [];
        dispatch.set(type, list);
      }
      list.push({ visitor: v, handler });
    }
  }
  return dispatch;
}

function runVisitorPipeline(tree: Tree, ctx: VisitorContext): void {
  const active = allVisitors.filter(v =>
    ctx.framework === "unknown"
      ? v.appliesTo.includes("pinocchio") && v.appliesTo.includes("anchor")
      : v.appliesTo.includes(ctx.framework),
  );

  for (const v of active) {
    try {
      v.before?.(tree, ctx);
    } catch (err) {
      ctx.output.suggestions.push(`Visitor \`${v.name}\` failed in before(): ${(err as Error).message}`);
    }
  }

  const dispatch = buildDispatch(active);
  if (dispatch.size > 0) {
    walk(tree.rootNode, node => {
      const list = dispatch.get(node.type);
      if (!list) return;
      for (const { visitor, handler } of list) {
        try {
          handler(node, ctx);
        } catch (err) {
          ctx.output.suggestions.push(`Visitor \`${visitor.name}\` threw on ${node.type}: ${(err as Error).message}`);
        }
      }
    });
  }

  for (const v of active) {
    try {
      v.after?.(ctx);
    } catch (err) {
      ctx.output.suggestions.push(`Visitor \`${v.name}\` failed in after(): ${(err as Error).message}`);
    }
  }
}

export interface RunAutofixerArgs {
  code: string;
  filename?: string;
  framework?: Framework | "auto";
}

export async function runProgramAutofixer({
  code,
  filename = "input.rs",
  framework = "auto",
}: RunAutofixerArgs): Promise<AutofixerOutput> {
  const output: AutofixerOutput = {
    issues: [],
    suggestions: [],
    framework_detected: "unknown",
    require_another_tool_call_after_fixing: false,
  };

  let tree;
  try {
    tree = await parseRust(code);
  } catch (err) {
    output.issues.push({
      severity: "high",
      rule: "parse-error",
      title: "Failed to parse Rust source",
      location: `${filename}:1:1`,
      description: `tree-sitter could not parse the input: ${(err as Error).message}`,
      suggestion: "Confirm the input is valid Rust (a single file or concatenated module).",
    });
    output.require_another_tool_call_after_fixing = true;
    return output;
  }

  if (tree.rootNode.hasError) {
    output.suggestions.push(
      "Parser reported syntax errors in the input. Fix syntax first; some lint rules may be unreliable on partially-parsed code.",
    );
  }

  const detectedFramework = detectFramework(tree);
  const resolvedFramework: Framework = framework === "auto" ? detectedFramework : framework;
  output.framework_detected = detectedFramework;

  const ctx: VisitorContext = {
    source: code,
    filename,
    framework: resolvedFramework,
    output,
    tryFromBodies: findTryFromBodies(tree),
    anchor: collectAnchorContext(tree),
  };

  runVisitorPipeline(tree, ctx);

  output.issues = dedupe(output.issues);
  output.require_another_tool_call_after_fixing =
    tree.rootNode.hasError || output.issues.some(i => i.severity === "critical" || i.severity === "high");

  return output;
}
