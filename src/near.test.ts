import { beforeEach, describe, expect, it, vi } from "vitest";
import { sendTransfer, verifyTransfer } from "./near";

const hash = "1".repeat(44);
const expected = { signer: "alice.testnet", destination: "bob.testnet", amountYocto: "1000" };

function rpcResult(transaction: Record<string, unknown>, status: Record<string, unknown> = { SuccessValue: "" }, finalExecutionStatus = "FINAL", omitFinality = false) {
  return vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({
    jsonrpc: "2.0", id: 1, result: { transaction, status, ...(omitFinality ? {} : { final_execution_status: finalExecutionStatus }) },
  }), { status: 200, headers: { "content-type": "application/json" } }));
}

const goodTransaction = () => ({
  hash,
  signer_id: expected.signer,
  receiver_id: expected.destination,
  actions: [{ Transfer: { deposit: expected.amountYocto } }],
});

describe("verifyTransfer", () => {
  beforeEach(() => vi.restoreAllMocks());

  it("accepts only a final successful exact one-action transfer", async () => {
    rpcResult(goodTransaction());
    const result = await verifyTransfer(hash, expected);
    expect(result.transactionHash).toBe(hash);
    expect(Number.isNaN(Date.parse(result.verifiedAt))).toBe(false);
  });

  it.each([
    ["wrong signer", { signer_id: "mallory.testnet" }],
    ["wrong recipient", { receiver_id: "mallory.testnet" }],
    ["wrong amount", { actions: [{ Transfer: { deposit: "1001" } }] }],
  ])("rejects %s", async (_label, alteration) => {
    rpcResult({ ...goodTransaction(), ...alteration });
    await expect(verifyTransfer(hash, expected)).rejects.toThrow();
  });

  it("rejects pending and failed outcomes", async () => {
    rpcResult(goodTransaction(), { Unknown: "" });
    await expect(verifyTransfer(hash, expected)).rejects.toThrow();
    vi.restoreAllMocks();
    rpcResult(goodTransaction(), { Failure: { ActionError: {} } });
    await expect(verifyTransfer(hash, expected)).rejects.toThrow();
  });

  it("rejects optimistic finality", async () => {
    rpcResult(goodTransaction(), { SuccessValue: "" }, "EXECUTED_OPTIMISTIC");
    await expect(verifyTransfer(hash, expected)).rejects.toThrow();
  });

  it("rejects absent finality", async () => {
    rpcResult(goodTransaction(), { SuccessValue: "" }, "FINAL", true);
    await expect(verifyTransfer(hash, expected)).rejects.toThrow();
  });

  it("rejects extra actions even when the transfer is present", async () => {
    rpcResult({ ...goodTransaction(), actions: [
      { Transfer: { deposit: expected.amountYocto } },
      { CreateAccount: {} },
    ] });
    await expect(verifyTransfer(hash, expected)).rejects.toThrow();
  });

  it("rejects an RPC transaction error instead of treating it as a non-final transfer", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({
      jsonrpc: "2.0", id: 1, error: { code: -32000, message: "node unavailable" },
    }), { status: 200 }));
    await expect(verifyTransfer(hash, expected)).rejects.toThrow("node unavailable");
  });

  it("propagates a timeout/network failure from transaction RPC", async () => {
    vi.spyOn(globalThis, "fetch").mockRejectedValue(new DOMException("The operation was aborted", "AbortError"));
    await expect(verifyTransfer(hash, expected)).rejects.toThrow("aborted");
  });

  it("rejects a final outcome whose returned transaction hash differs from the requested hash", async () => {
    rpcResult({ ...goodTransaction(), hash: "2".repeat(44) });
    await expect(verifyTransfer(hash, expected)).rejects.toThrow();
  });
});

describe("sendTransfer validation", () => {
  it.each(["bob..testnet", "Bob.testnet", "https://bob.testnet", "bob.near", "bob--a.testnet", "bob__a.testnet"])("rejects invalid destination %s", async (destination) => {
    await expect(sendTransfer({ destination, signer: expected.signer, amountYocto: expected.amountYocto })).rejects.toThrow("Invalid NEAR destination account");
  });

  it("rejects a non-testnet named signer before contacting RPC or wallet", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch");
    await expect(sendTransfer({ destination: expected.destination, signer: "alice.near", amountYocto: expected.amountYocto })).rejects.toThrow("Invalid NEAR signer account");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("propagates signer RPC failures instead of reporting a missing signer", async () => {
    vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("RPC timeout"));
    await expect(sendTransfer({ destination: expected.destination, signer: expected.signer, amountYocto: expected.amountYocto })).rejects.toThrow("RPC timeout");
  });

  it("propagates HTTP/RPC errors while checking the recipient", async () => {
    vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(new Response(JSON.stringify({ result: {} }), { status: 200 }))
      .mockResolvedValueOnce(new Response("gateway timeout", { status: 504 }));
    await expect(sendTransfer({ destination: expected.destination, signer: expected.signer, amountYocto: expected.amountYocto })).rejects.toThrow("NEAR RPC HTTP 504");
  });
});
