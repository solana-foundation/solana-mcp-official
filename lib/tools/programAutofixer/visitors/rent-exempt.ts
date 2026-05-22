import type { Node } from "web-tree-sitter";
import type { Visitor } from "../types.js";
import { formatLocation, snippet } from "../types.js";

function isCreateAccountStruct(node: Node): boolean {
  if (node.type !== "struct_expression") return false;
  const typeId = node.namedChild(0);
  if (!typeId) return false;
  if (typeId.type === "type_identifier") return typeId.text === "CreateAccount";
  if (typeId.type === "scoped_type_identifier" || typeId.type === "scoped_identifier") {
    const last = typeId.namedChild(typeId.namedChildCount - 1);
    return last?.text === "CreateAccount";
  }
  return false;
}

function getFieldInitValue(struct: Node, fieldName: string): Node | null {
  const list = struct.namedChild(1);
  if (!list || list.type !== "field_initializer_list") return null;
  for (let i = 0; i < list.namedChildCount; i++) {
    const init = list.namedChild(i);
    if (!init || init.type !== "field_initializer") continue;
    const name = init.namedChild(0);
    if (name?.text === fieldName) return init.namedChild(init.namedChildCount - 1);
  }
  return null;
}

export const rentExempt: Visitor = {
  name: "rent-exempt",
  severity: "medium",
  appliesTo: ["pinocchio"],
  enter: {
    struct_expression(node, ctx) {
      if (!isCreateAccountStruct(node)) return;
      const lamportsExpr = getFieldInitValue(node, "lamports");
      if (!lamportsExpr) return;
      // Acceptable: identifier (assumed rent-derived), call_expression, field_expression.
      // Reject: integer_literal (hardcoded).
      if (lamportsExpr.type !== "integer_literal") return;
      ctx.output.issues.push({
        severity: "medium",
        rule: "rent-exempt",
        title: `CreateAccount uses a hardcoded lamports value`,
        location: formatLocation(ctx.filename, lamportsExpr),
        description: `\`CreateAccount { lamports: ${lamportsExpr.text}, .. }\` hardcodes the lamports amount instead of computing rent-exempt minimum. If the rent rate changes or the account size is larger than expected, the new account will be subject to rent collection.`,
        suggestion: `Use the real Pinocchio rent sysvar: import \`pinocchio::sysvars::{rent::Rent, Sysvar}\`, compute \`let lamports = Rent::get()?.try_minimum_balance(space as usize)?;\`, and pass that \`lamports\` value to \`CreateAccount\`. Do not create a local \`Rent\` shim or hardcode a fallback value.`,
        code_snippet: snippet(ctx.source, node, 100),
      });
    },
  },
};
