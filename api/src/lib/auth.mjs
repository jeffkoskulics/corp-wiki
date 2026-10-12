// Azure Static Web Apps forwards the signed-in user in the x-ms-client-principal header.
// Route-level role checks live in staticwebapp.config.json; this is a second check plus commit attribution.

import { HttpError } from "./github.mjs";

export function getUser(request) {
  const header = request.headers.get("x-ms-client-principal");
  if (!header) return null;
  try {
    return JSON.parse(Buffer.from(header, "base64").toString("utf8"));
  } catch {
    return null;
  }
}

export function requireEditor(request) {
  const user = getUser(request);
  const role = process.env.EDITOR_ROLE || "editor";
  if (!user || !user.userRoles?.includes(role)) throw new HttpError(403, "You do not have edit rights.");
  const email = user.userDetails || "unknown@example.com";
  const name = user.claims?.find((c) => c.typ === "name")?.val || email;
  return { name, email };
}
