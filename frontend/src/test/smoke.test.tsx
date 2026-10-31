import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { Button } from "../components/ui/Button";
import { Badge } from "../components/ui/Badge";
import { Progress } from "../components/ui/Progress";
import { formatDate, formatMinutes, priorityStyle, statusLabels } from "../lib/utils";

describe("utility formatting", () => {
  it("formats minutes into hours", () => {
    expect(formatMinutes(45)).toBe("45 min");
    expect(formatMinutes(60)).toBe("1h");
    expect(formatMinutes(135)).toBe("2h 15m");
  });

  it("handles missing dates gracefully", () => {
    expect(formatDate(null)).toBeTruthy();
    expect(formatDate(undefined)).toBeTruthy();
  });

  it("exposes priority styles and status labels", () => {
    expect(priorityStyle.high).toContain("danger");
    expect(statusLabels.not_started).toBe("Not started");
  });
});

describe("basic UI primitives", () => {
  it("renders and triggers a button", () => {
    const onClick = vi.fn();
    render(<Button onClick={onClick}>Start learning</Button>);
    fireEvent.click(screen.getByRole("button", { name: "Start learning" }));
    expect(onClick).toHaveBeenCalledOnce();
  });

  it("renders a badge and progress bar", () => {
    render(
      <div>
        <Badge>High priority</Badge>
        <Progress value={62} />
      </div>,
    );
    expect(screen.getByText("High priority")).toBeInTheDocument();
    expect(screen.getByRole("progressbar")).toHaveAttribute("aria-valuenow", "62");
  });
});
