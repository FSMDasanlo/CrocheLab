import { execute } from "./execute.mjs";

export function validateDocument(document) {
  const result = execute(document);
  return { status: result.status, diagnostics: result.diagnostics };
}
