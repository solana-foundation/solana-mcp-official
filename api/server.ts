import * as dotenv from 'dotenv';

import { createMcp } from "../lib";

dotenv.config();

function handler(req: Request) {
  return createMcp()(req);
}

export { handler as GET };
export { handler as POST };
export { handler as DELETE };
