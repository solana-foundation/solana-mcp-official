export function useDatabricks(): boolean {
  return process.env.USE_DATABRICKS === "1";
}
