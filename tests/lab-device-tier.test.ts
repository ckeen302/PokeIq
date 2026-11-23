import { describe, expect, it } from "vitest";
import { classifyGpu, ladderStart, tierFrom, type DeviceSignals } from "@/lib/gl/device-tier";

const base: DeviceSignals = { phone: false, gpu: null, memoryGb: 8, cores: 8, probeMs: 1 };

describe("3D Lab device tier", () => {
  it("names software renderers, old mobile GPUs and strong ones", () => {
    expect(classifyGpu("ANGLE (Google, Vulkan 1.3.0 (SwiftShader Device (Subzero) (0x0000C0DE)), SwiftShader driver)")).toBe("software");
    expect(classifyGpu("llvmpipe (LLVM 15.0.7, 256 bits)")).toBe("software");
    expect(classifyGpu("Adreno (TM) 506")).toBe("weak");
    expect(classifyGpu("Mali-G52 MC2")).toBe("weak");
    expect(classifyGpu("Mali-T830")).toBe("weak");
    expect(classifyGpu("PowerVR Rogue GE8320")).toBe("weak");
    expect(classifyGpu("ANGLE (Intel, Intel(R) HD Graphics 4000 Direct3D11 vs_5_0 ps_5_0)")).toBe("weak");
    expect(classifyGpu("ANGLE (NVIDIA, NVIDIA GeForce RTX 3060 Direct3D11 vs_5_0 ps_5_0, D3D11)")).toBe("strong");
    expect(classifyGpu("ANGLE (Apple, ANGLE Metal Renderer: Apple M2, Unspecified Version)")).toBe("strong");
    expect(classifyGpu("Adreno (TM) 740")).toBe("strong");
    expect(classifyGpu("Mali-G710")).toBe("strong");
    expect(classifyGpu("Adreno (TM) 640")).toBe("unknown");
    expect(classifyGpu("Apple GPU")).toBe("unknown");
    expect(classifyGpu(null)).toBe("unknown");
  });

  it("puts software rendering, 2 GB devices and very slow CPUs on the lightest tier", () => {
    expect(tierFrom({ ...base, gpu: "SwiftShader" })).toBe(0);
    expect(tierFrom({ ...base, memoryGb: 2 })).toBe(0);
    expect(tierFrom({ ...base, probeMs: 20 })).toBe(0);
  });

  it("starts phones on tier 1, and weak phones on 0", () => {
    expect(tierFrom({ ...base, phone: true, memoryGb: 6 })).toBe(1);
    expect(tierFrom({ ...base, phone: true, memoryGb: 3 })).toBe(0);
    expect(tierFrom({ ...base, phone: true, gpu: "Mali-G52" })).toBe(0);
    expect(tierFrom({ ...base, phone: true, probeMs: 8 })).toBe(0);
    // iPhones report neither memory nor a GPU name: a typical phone.
    expect(tierFrom({ phone: true, gpu: "Apple GPU", cores: 6, probeMs: 1.5 })).toBe(1);
  });

  it("splits computers by GPU, cores and memory", () => {
    expect(tierFrom(base)).toBe(3);
    expect(tierFrom({ ...base, cores: 4 })).toBe(2);
    expect(tierFrom({ ...base, memoryGb: 4 })).toBe(2);
    expect(tierFrom({ ...base, cores: 4, gpu: "NVIDIA GeForce GTX 1650" })).toBe(3);
    expect(tierFrom({ ...base, gpu: "Intel(R) HD Graphics 5500" })).toBe(1);
    expect(tierFrom({ ...base, probeMs: 7 })).toBe(1);
  });

  it("maps a tier onto a scene's ladder", () => {
    const ladder = { weak: "low", phone: "low", laptop: "medium", desktop: "medium" } as const;
    expect(ladderStart(0, ladder)).toBe("low");
    expect(ladderStart(2, ladder)).toBe("medium");
  });
});
