import { concat, hashDomain, keccak256, pad, toHex, verifyTypedData, type Address } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { describe, expect, it } from "vitest";
import { USDT_ADDRESS, USDT_DOMAIN_SEPARATOR } from "../src/chain";
import {
  checkoutPaymentId,
  domainSeparator,
  invoiceTypedData,
  orderIdFromSessionId,
  paymentNonce,
  quietPayDomain,
  receiveWithAuthorizationTypedData,
  refundNonce,
  subscriptionPaymentId,
  subscriptionRef,
  toJsonTypedData,
  usdtDomain,
} from "../src/eip712";

const QP: Address = "0x1111111111111111111111111111111111111111";
const word = (n: bigint | number) => pad(toHex(BigInt(n)), { size: 32 });
const strTail = (s: string) => concat([word(s.length), pad(toHex(s), { size: 32, dir: "right" })]);

describe("domains", () => {
  it("USDT domain separator matches on-chain DOMAIN_SEPARATOR()", () => {
    expect(domainSeparator(usdtDomain())).toBe(USDT_DOMAIN_SEPARATOR);
  });

  it("agrees with viem's hashDomain", () => {
    const d = quietPayDomain(QP);
    const viemHash = hashDomain({
      domain: { ...d, chainId: BigInt(d.chainId) },
      types: {
        EIP712Domain: [
          { name: "name", type: "string" },
          { name: "version", type: "string" },
          { name: "chainId", type: "uint256" },
          { name: "verifyingContract", type: "address" },
        ],
      },
    });
    expect(domainSeparator(d)).toBe(viemHash);
  });

  it("uses chain 1874 and the right names", () => {
    expect(usdtDomain()).toEqual({ name: "Tether USD", version: "1", chainId: 1874, verifyingContract: USDT_ADDRESS });
    expect(quietPayDomain(QP)).toEqual({ name: "QuietPay", version: "1", chainId: 1874, verifyingContract: QP });
  });
});

describe("derived ids (match abi.encode in QuietPay.sol)", () => {
  const orderId = orderIdFromSessionId("sess_test123");
  const merchantId = 7n;

  it("orderId = keccak256(utf8(sessionId))", () => {
    expect(orderId).toBe(keccak256(toHex("sess_test123")));
    expect(orderId).toBe("0x04f695227a6e0702ebb5e23afb6d6f73af4dd0fd6b988bf07caacfeab8b05e11");
  });

  it("paymentNonce = keccak256(abi.encode(address(this), merchantId, orderId))", () => {
    const manual = keccak256(concat([pad(QP, { size: 32 }), word(merchantId), orderId]));
    expect(paymentNonce(QP, merchantId, orderId)).toBe(manual);
  });

  it("checkoutPaymentId = keccak256(abi.encode(merchantId, orderId))", () => {
    const manual = keccak256(concat([word(merchantId), orderId]));
    expect(checkoutPaymentId(merchantId, orderId)).toBe(manual);
  });

  it('subscriptionPaymentId = keccak256(abi.encode("sub", subId, cycle))', () => {
    // dynamic string: head = [offset 0x60, subId, cycle], tail = [len, data]
    const manual = keccak256(concat([word(0x60), word(3n), word(2), strTail("sub")]));
    expect(subscriptionPaymentId(3n, 2)).toBe(manual);
  });

  it('refundNonce = keccak256(abi.encode(address(this), "refund", paymentId, seq))', () => {
    const paymentId = checkoutPaymentId(merchantId, orderId);
    const manual = keccak256(concat([pad(QP, { size: 32 }), word(0x80), paymentId, word(1), strTail("refund")]));
    expect(refundNonce(QP, paymentId, 1)).toBe(manual);
    expect(refundNonce(QP, paymentId, 0)).not.toBe(refundNonce(QP, paymentId, 1));
  });

  it("subscriptionRef = bytes32(subId)", () => {
    expect(subscriptionRef(5n)).toBe(word(5n));
  });

  // Pinned so contracts/test can assert the same values from Solidity (A4).
  it("pinned values for QuietPay=0x1111…1111, merchantId=7, session sess_test123", () => {
    const paymentId = checkoutPaymentId(merchantId, orderId);
    expect(paymentNonce(QP, merchantId, orderId)).toBe("0x41e548384ace9b0b32ee3c4e5bf6cd90f16a58174afdc5f60eddcdcaa9d6003d");
    expect(paymentId).toBe("0xea535357cccc1394d00c99250163a0124d42b8d9362eaa5fca6ae21a9cc3d398");
    expect(subscriptionPaymentId(3n, 2)).toBe("0xfb9717a01f491dc09018707005e5d9d6aa6c952fefc8a0754629f41a02f407bf");
    expect(refundNonce(QP, paymentId, 1)).toBe("0x06f04f30beaa5a8b4cfaf8fb3ffdbdf3f0c09d37eb5245e7741d980561b7b218");
  });
});

describe("typed data", () => {
  const signer = privateKeyToAccount("0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d");

  it("Invoice signatures verify", async () => {
    const td = invoiceTypedData(QP, {
      merchantId: 1n,
      orderId: orderIdFromSessionId("sess_a"),
      amount: 25_000_000n,
      expiresAt: 1_900_000_000n,
    });
    const sig = await signer.signTypedData(td);
    expect(await verifyTypedData({ ...td, address: signer.address, signature: sig })).toBe(true);
  });

  it("JSON typed data (string uints) signs the same as bigint typed data", async () => {
    const td = receiveWithAuthorizationTypedData({
      from: signer.address,
      to: QP,
      value: 37_000_000n,
      validAfter: 0n,
      validBefore: 1_900_000_000n,
      nonce: paymentNonce(QP, 1n, orderIdFromSessionId("sess_b")),
    });
    const json = toJsonTypedData(td);
    expect(json.message.value).toBe("37000000");
    expect(JSON.parse(JSON.stringify(json))).toEqual(json);
    const a = await signer.signTypedData(td);
    const b = await signer.signTypedData(json as never);
    expect(b).toBe(a);
  });
});
