import { handleMcpRequest } from "../lib/handler";

function handler(req: Request): Promise<Response> {
  return handleMcpRequest(req);
}

export { handler as GET };
export { handler as POST };
export { handler as DELETE };
