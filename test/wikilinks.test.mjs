import { test } from "node:test";
import assert from "node:assert/strict";
import { rewriteLinks, extractLinks, cleanPath, quartzSlug } from "../api/src/lib/wikilinks.mjs";

const all = ["Networking/VPN Setup.md", "Home.md", "Azure/Subscriptions.md"];

test("rewrites bare, aliased, heading and embed links", () => {
  const src = "See [[VPN Setup]], [[VPN Setup|the VPN]], [[vpn setup#Windows]] and ![[VPN Setup]].";
  const { text, count } = rewriteLinks(src, "Networking/VPN Setup.md", "Networking/Remote Access.md", all);
  assert.equal(count, 4);
  assert.equal(text, "See [[Remote Access]], [[Remote Access|the VPN]], [[Remote Access#Windows]] and ![[Remote Access]].");
});

test("rewrites path-qualified links with the new path", () => {
  const { text } = rewriteLinks("[[Networking/VPN Setup#^abc|x]]", "Networking/VPN Setup.md", "Infra/VPN.md", all);
  assert.equal(text, "[[Infra/VPN#^abc|x]]");
});

test("leaves code and unrelated links alone", () => {
  const src = "`[[VPN Setup]]`\n```\n[[VPN Setup]]\n```\n[[Home]] [[VPN Setup Guide]]";
  const { text, count } = rewriteLinks(src, "Networking/VPN Setup.md", "Networking/X.md", all);
  assert.equal(count, 0);
  assert.equal(text, src);
});

test("uses full path when new basename would be ambiguous", () => {
  const { text } = rewriteLinks("[[VPN Setup]]", "Networking/VPN Setup.md", "Networking/Home.md", all);
  assert.equal(text, "[[Networking/Home]]");
});

test("does not touch bare links when old basename is shared", () => {
  const paths = [...all, "Other/VPN Setup.md"];
  const { count } = rewriteLinks("[[VPN Setup]]", "Networking/VPN Setup.md", "Networking/Y.md", paths);
  assert.equal(count, 0);
});

test("extractLinks and helpers", () => {
  assert.deepEqual(extractLinks("[[A]] `[[B]]` ![[C|c]]"), ["A", "C"]);
  assert.equal(cleanPath("/Azure/New Page"), "Azure/New Page.md");
  assert.throws(() => cleanPath("../etc/passwd"));
  assert.equal(quartzSlug("Azure/Cost & Billing.md"), "Azure/Cost--and--Billing");
});
