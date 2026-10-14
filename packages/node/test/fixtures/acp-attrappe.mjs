// ACP-Agent als Attrappe für code-motor.test.ts (VKc2): spricht ACP über stdin/stdout wie ein echter
// Motor (Hermes), legt nach der Freigabe eine Datei im Arbeitsordner an und meldet sich fertig.
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { Readable, Writable } from "node:stream";
import { agent, ndJsonStream, PROTOCOL_VERSION } from "@agentclientprotocol/sdk";

let cwd = "";
const app = agent({ name: "attrappe" })
  .onRequest("initialize", () => ({ protocolVersion: PROTOCOL_VERSION, agentCapabilities: {} }))
  .onRequest("session/new", ({ params }) => {
    cwd = params.cwd;
    return { sessionId: "s1" };
  })
  .onRequest("session/prompt", async ({ params, client }) => {
    const update = (u) => client.notify("session/update", { sessionId: params.sessionId, update: u });
    await update({ sessionUpdate: "tool_call", toolCallId: "t1", title: "Datei anlegen", kind: "edit", status: "pending", rawInput: { command: "echo prozess > p.txt" } });
    const r = await client.request("session/request_permission", {
      sessionId: params.sessionId, toolCall: { toolCallId: "t1" },
      options: [{ optionId: "ja", name: "Ja", kind: "allow_once" }, { optionId: "nein", name: "Nein", kind: "reject_once" }],
    });
    const ja = r.outcome.outcome === "selected" && r.outcome.optionId === "ja";
    if (ja) writeFileSync(join(cwd, "p.txt"), `prozess ${process.env.HOME === cwd} ${process.env.GEHEIM ?? "-"}\n`);
    await update({ sessionUpdate: "tool_call_update", toolCallId: "t1", status: ja ? "completed" : "failed", rawOutput: { stdout: "ok", exit_code: ja ? 0 : 3 } });
    await update({ sessionUpdate: "agent_message_chunk", content: { type: "text", text: "Prozess fertig." } });
    return { stopReason: "end_turn" };
  });
app.connect(ndJsonStream(Writable.toWeb(process.stdout), Readable.toWeb(process.stdin)));
