import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ChatInput } from "./ChatInput";

vi.mock("../../components/useI18n", () => ({
  useI18n: () => ({
    t: (key: string) => key,
  }),
}));

describe("ChatInput", () => {
  it("passes spellCheck=true to the composer textarea", () => {
    render(
      <ChatInput
        isLoading={false}
        hasSession={false}
        spellCheck={true}
        onSubmit={() => {}}
        onQuickAsk={() => {}}
        onAbort={() => {}}
      />,
    );

    expect(screen.getByRole("textbox")).toHaveAttribute("spellcheck", "true");
  });

  it("passes spellCheck=false to the composer textarea", () => {
    render(
      <ChatInput
        isLoading={false}
        hasSession={false}
        spellCheck={false}
        onSubmit={() => {}}
        onQuickAsk={() => {}}
        onAbort={() => {}}
      />,
    );

    expect(screen.getByRole("textbox")).toHaveAttribute("spellcheck", "false");
  });

  it("shows the draft translation action when on-demand translation is enabled", () => {
    render(
      <ChatInput
        isLoading={false}
        hasSession={false}
        translationSettings={{
          mode: "on_demand",
          modelRef: "",
          sourceLanguage: "auto",
          targetLanguage: "German",
          preserveTone: true,
        }}
        onSubmit={() => {}}
        onQuickAsk={() => {}}
        onAbort={() => {}}
      />,
    );

    expect(
      screen.getByRole("button", { name: "chat.translateDraft" }),
    ).toBeInTheDocument();
  });

  it("keeps the draft translation action visible but disabled without a target language", () => {
    render(
      <ChatInput
        isLoading={false}
        hasSession={false}
        translationSettings={{
          mode: "on_demand",
          modelRef: "",
          sourceLanguage: "auto",
          targetLanguage: "",
          preserveTone: true,
        }}
        onSubmit={() => {}}
        onQuickAsk={() => {}}
        onAbort={() => {}}
      />,
    );

    expect(
      screen.getByRole("button", { name: "chat.translateDraft" }),
    ).toBeDisabled();
  });

  it("shows the selection translation action after selecting text", () => {
    render(
      <ChatInput
        isLoading={false}
        hasSession={false}
        translationSettings={{
          mode: "on_demand",
          modelRef: "",
          sourceLanguage: "auto",
          targetLanguage: "German",
          preserveTone: true,
        }}
        onSubmit={() => {}}
        onQuickAsk={() => {}}
        onAbort={() => {}}
      />,
    );

    const textarea = screen.getByRole("textbox") as HTMLTextAreaElement;
    fireEvent.change(textarea, { target: { value: "hello world" } });
    textarea.setSelectionRange(0, 5);
    fireEvent.select(textarea);

    expect(
      screen.getByRole("button", { name: "chat.translateSelection" }),
    ).toBeInTheDocument();
  });

  it("shows a fallback title when the saved translation model is missing", () => {
    render(
      <ChatInput
        isLoading={false}
        hasSession={false}
        translationSettings={{
          mode: "on_demand",
          modelRef: "missing-model",
          sourceLanguage: "auto",
          targetLanguage: "German",
          preserveTone: true,
        }}
        translationModelMissing={true}
        onSubmit={() => {}}
        onQuickAsk={() => {}}
        onAbort={() => {}}
      />,
    );

    expect(
      screen.getByRole("button", { name: "chat.translateDraft" }),
    ).toHaveAttribute("title", "chat.translationModelFallback");
  });

  it("shows dictionary autocomplete suggestions from sent drafts", () => {
    render(
      <ChatInput
        isLoading={false}
        hasSession={false}
        autocompleteSettings={{
          mode: "dictionary",
          modelRef: "",
          debounceMs: 250,
          minChars: 2,
        }}
        onSubmit={() => {}}
        onQuickAsk={() => {}}
        onAbort={() => {}}
      />,
    );

    const textarea = screen.getByRole("textbox");
    fireEvent.change(textarea, { target: { value: "hello world" } });
    fireEvent.click(screen.getByRole("button", { name: "chat.send" }));
    fireEvent.change(textarea, { target: { value: "he" } });

    expect(screen.getByText("hello")).toBeInTheDocument();
  });

  it("accepts a dictionary autocomplete suggestion with Tab", () => {
    render(
      <ChatInput
        isLoading={false}
        hasSession={false}
        autocompleteSettings={{
          mode: "dictionary",
          modelRef: "",
          debounceMs: 250,
          minChars: 2,
        }}
        onSubmit={() => {}}
        onQuickAsk={() => {}}
        onAbort={() => {}}
      />,
    );

    const textarea = screen.getByRole("textbox") as HTMLTextAreaElement;
    fireEvent.change(textarea, { target: { value: "hello world" } });
    fireEvent.click(screen.getByRole("button", { name: "chat.send" }));
    fireEvent.change(textarea, { target: { value: "he" } });
    fireEvent.keyDown(textarea, { key: "Tab" });

    expect(textarea.value).toBe("hello ");
  });
});
