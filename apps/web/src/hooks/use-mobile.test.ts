import { describe, it, expect, vi, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useMobile } from "./use-mobile";

describe("useMobile", () => {
  const originalMatchMedia = window.matchMedia;

  afterEach(() => {
    window.matchMedia = originalMatchMedia;
  });

  it("returns undefined initially before effect runs", () => {
    const mockMql = {
      matches: false,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    };
    window.matchMedia = vi.fn().mockReturnValue(mockMql);

    const { result } = renderHook(() => useMobile());
    expect(result.current).toBe(false);
  });

  it("returns true when viewport is mobile", () => {
    const mockMql = {
      matches: true,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    };
    window.matchMedia = vi.fn().mockReturnValue(mockMql);

    const { result } = renderHook(() => useMobile());
    expect(result.current).toBe(true);
  });

  it("updates when media query changes", () => {
    let changeHandler: ((e: { matches: boolean }) => void) | null = null;
    const mockMql = {
      matches: false,
      addEventListener: vi.fn((_, handler) => {
        changeHandler = handler;
      }),
      removeEventListener: vi.fn(),
    };
    window.matchMedia = vi.fn().mockReturnValue(mockMql);

    const { result } = renderHook(() => useMobile());
    expect(result.current).toBe(false);

    act(() => {
      changeHandler?.({ matches: true });
    });
    expect(result.current).toBe(true);
  });

  it("cleans up event listener on unmount", () => {
    const mockMql = {
      matches: false,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    };
    window.matchMedia = vi.fn().mockReturnValue(mockMql);

    const { unmount } = renderHook(() => useMobile());
    unmount();

    expect(mockMql.removeEventListener).toHaveBeenCalledWith(
      "change",
      expect.any(Function)
    );
  });
});
