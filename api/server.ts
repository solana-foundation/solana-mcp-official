import * as dotenv from "dotenv";

import { handleMcpRequest } from "../lib/handler";

dotenv.config();

function handler(req: Request): Promise<Response> {
  return handleMcpRequest(req);
}

export { handler as GET };
export { handler as POST };
export { handler as DELETE };
