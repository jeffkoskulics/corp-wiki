import { app } from "@azure/functions";

// Called by Static Web Apps on login (auth.rolesSource). Returns extra roles for the user.
// EDITOR_GROUP_ID unset  -> every signed-in employee can edit.
// EDITOR_GROUP_ID set    -> only members of that Entra group (requires the "groups" claim on the app registration).
app.http("roles", {
  methods: ["POST"],
  route: "roles",
  handler: async (request) => {
    const user = await request.json().catch(() => ({}));
    const group = process.env.EDITOR_GROUP_ID;
    const groups = (user.claims || []).filter((c) => c.typ === "groups").map((c) => c.val);
    const isEditor = !group || groups.includes(group);
    return { status: 200, jsonBody: { roles: isEditor ? [process.env.EDITOR_ROLE || "editor"] : [] } };
  },
});
