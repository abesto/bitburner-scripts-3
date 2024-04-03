---
to: rpc/PORTS.ts
inject: true
append: true
---
export const <%= h.changeCase.constant(name) %> = <%= port %>;
