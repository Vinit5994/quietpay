import { afterEach, describe, expect, it, vi } from "vitest";

const { readContract } = vi.hoisted(() => ({ readContract: vi.fn() }));
vi.mock("viem", async (importOriginal) => ({
  ...await importOriginal<typeof import("viem")>(),
  createPublicClient: () => ({ readContract }),
}));

import { loadAdminAccess } from "./chain";

const owner = "0xa0f97344e9699F0D5d54c4158F9cf9892828C7F8";
const other = "0x1111111111111111111111111111111111111111";

afterEach(() => {
  vi.resetAllMocks();
  vi.unstubAllEnvs();
});

describe("platform overview access", () => {
  it("recognizes the current contract owner regardless of address casing", async () => {
    vi.stubEnv("NEXT_PUBLIC_ADMIN_ADDRESSES", "");
    readContract.mockResolvedValue(owner);
    expect((await loadAdminAccess(owner.toLowerCase())).allowed).toBe(true);
    expect(readContract).toHaveBeenCalledWith(expect.objectContaining({ functionName: "owner" }));
  });

  it("does not grant access to another merchant wallet", async () => {
    vi.stubEnv("NEXT_PUBLIC_ADMIN_ADDRESSES", "");
    readContract.mockResolvedValue(owner);
    expect((await loadAdminAccess(other)).allowed).toBe(false);
  });

  it("preserves access for configured team wallets", async () => {
    vi.stubEnv("NEXT_PUBLIC_ADMIN_ADDRESSES", other);
    expect((await loadAdminAccess(other)).allowed).toBe(true);
    expect(readContract).not.toHaveBeenCalled();
  });

  it("does not grant access without a connected wallet", async () => {
    expect((await loadAdminAccess(null)).allowed).toBe(false);
    expect(readContract).not.toHaveBeenCalled();
  });
});
