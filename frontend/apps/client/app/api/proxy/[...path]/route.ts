// See packages/core/lib/proxy.ts for what this actually does.
import { createProxyHandlers } from "@/lib/proxy";

export const { GET, POST, PATCH, PUT, DELETE } = createProxyHandlers();
